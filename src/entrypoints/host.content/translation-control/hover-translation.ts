import type { Config } from "@/types/config/config"
import { getLocalConfig, watchLocalConfig } from "@/utils/config/storage"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { isExtensionContextInvalidatedError, isExtensionContextValid } from "@/utils/extension-context"
import { flushBatchedOperations } from "@/utils/host/dom/batch-dom"
import { hasNoWalkAncestor, isHTMLElement } from "@/utils/host/dom/filter"
import { findNearestAncestorBlockNodeFor } from "@/utils/host/dom/find"
import { walkAndLabelElement } from "@/utils/host/dom/traversal"
import { translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { validateTranslationConfigAndToast } from "@/utils/host/translate/translate-text"
import { translateTextForPage } from "@/utils/host/translate/translate-variants"
import { createInlineHoverStreamPreview } from "@/utils/host/translate/ui/inline-hover-stream-preview"
import { isEditableTarget } from "@/utils/hotkeys"
import { logger } from "@/utils/logger"

const KEYBOARD_TRIGGERS = { "Alt": "alt", "Control": "control", "Shift": "shift", "`": "backtick" } as const

/** Read Frog's tap-or-hold keyboard interaction and mouse hold, using the paragraph renderer. */
export function bindHoverTranslation(target: Document = document) {
  let hovered: Element | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let session = 0
  let press: { hotkey: Config["features"]["hoverHotkey"], trigger: () => void } | null = null
  const pressedKeys = new Set<string>()
  let busy = false
  let activeTranslation: AbortController | undefined
  let activeCompletion: Promise<void> | undefined
  let mouseStart: { x: number, y: number } | null = null
  const controller = new AbortController()
  const cancel = () => {
    session++
    press = null
    mouseStart = null
    clearTimeout(timer)
    timer = undefined
  }
  const move = (event: MouseEvent) => {
    if (mouseStart && Math.hypot(event.clientX - mouseStart.x, event.clientY - mouseStart.y) > 6)
      cancel()
    const candidate = event.composedPath()[0]
    hovered = candidate instanceof Element ? candidate : null
  }
  const translate = async (element: Element, config: Config) => {
    const block = findNearestAncestorBlockNodeFor(element)
    if (!isHTMLElement(block) || block === target.body || block === target.documentElement || hasNoWalkAncestor(block)
      || block.closest("input,textarea,[contenteditable]:not([contenteditable='false']),video,[data-readomi-subtitles]") || !block.textContent?.trim()) {
      return
    }
    if (!validateTranslationConfigAndToast(config))
      return
    activeTranslation?.abort()
    busy = true
    const request = new AbortController()
    activeTranslation = request
    const signal = AbortSignal.any([controller.signal, request.signal])
    let preview: ReturnType<typeof createInlineHoverStreamPreview>
    const disposePreview = () => preview?.dispose()
    signal.addEventListener("abort", disposePreview, { once: true })
    try {
      preview = config.features.hoverStream ? createInlineHoverStreamPreview(block, config, () => request.abort()) : undefined
      const walkId = getRandomUUID()
      walkAndLabelElement(block, walkId, config)
      const requests: { result: Promise<string>, resolve: (text: string) => void, reject: (error: unknown) => void }[] = []
      const translateGroup = Object.assign((text: string, typographyElement?: HTMLElement, hideSpinner?: () => void) => {
        const onPartial = preview?.register(typographyElement, hideSpinner)
        const result = new Promise<string>((resolve, reject) => {
          const abort = () => reject(new DOMException("Translation cancelled", "AbortError"))
          signal.addEventListener("abort", abort, { once: true })
          void translateTextForPage(text, { onPartial, signal }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
        })
        return new Promise<string>((resolve, reject) => requests.push({ result, resolve, reject }))
      }, { showSpinner: true })
      const finished = translateWalkedElement(block, walkId, config, true, signal, translateGroup)
      // The walker registers every group synchronously. Release their finished
      // results together so a paragraph with several groups settles at once.
      const results = await Promise.allSettled(requests.map(request => request.result))
      if (preview && requests.length && results.every(result => result.status === "fulfilled") && !signal.aborted) {
        // Finish the smooth reveal before the canonical paragraph renderer
        // takes over. The reader stays at the same paragraph throughout.
        busy = false
        const apply = await preview.finish(results.map(result => result.value))
        if (!apply)
          request.abort()
      }
      const commit = async () => {
        results.forEach((result, index) => {
          if (signal.aborted)
            requests[index].reject(new DOMException("Translation cancelled", "AbortError"))
          else if (result.status === "fulfilled")
            requests[index].resolve(result.value)
          else
            requests[index].reject(result.reason)
        })
        await finished
        flushBatchedOperations()
      }
      if (preview)
        await preview.commitToPage(commit)
      else
        await commit()
    }
    catch (error) {
      if (!signal.aborted && isExtensionContextValid() && !isExtensionContextInvalidatedError(error))
        logger.error("Hover translation failed", error)
    }
    finally {
      signal.removeEventListener("abort", disposePreview)
      preview?.dispose()
      if (activeTranslation === request) {
        activeTranslation = undefined
        busy = false
      }
    }
  }
  const start = (hotkey: Config["features"]["hoverHotkey"], element: Element | null) => {
    if (!element || press || busy || controller.signal.aborted || !isExtensionContextValid())
      return
    const token = ++session
    let triggered = false
    const trigger = () => {
      // Claim the press before reading storage, so keyup cannot trigger it twice.
      if (triggered)
        return
      triggered = true
      const candidate = hotkey === "clickAndHold" ? element : hovered ?? element
      void getLocalConfig().then(async (config) => {
        if (config?.features.hoverTranslation && config.features.hoverHotkey === hotkey && token === session && !busy && !controller.signal.aborted && candidate.isConnected) {
          // Finish restoring the previous paragraph before walking another one.
          // This matters when a completed replacement preview is dismissed by
          // another hover: its saved original must not outlive the next walk.
          activeTranslation?.abort()
          await activeCompletion
          if (token !== session || busy || controller.signal.aborted || !candidate.isConnected)
            return
          const completion = translate(candidate, config)
          activeCompletion = completion
          await completion
          if (activeCompletion === completion)
            activeCompletion = undefined
        }
      }).catch((error) => {
        if (!controller.signal.aborted && isExtensionContextValid() && !isExtensionContextInvalidatedError(error))
          logger.error("Hover configuration failed", error)
      })
    }
    press = { hotkey, trigger }
    timer = setTimeout(trigger, 500)
  }
  const reset = () => {
    pressedKeys.clear()
    cancel()
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.repeat)
      return
    if (event.key === "Escape") {
      reset()
      activeTranslation?.abort()
      return
    }
    pressedKeys.add(event.code || event.key)
    const hotkey = KEYBOARD_TRIGGERS[event.key as keyof typeof KEYBOARD_TRIGGERS]
    if (!hotkey || pressedKeys.size !== 1 || event.metaKey || (event.ctrlKey && hotkey !== "control") || (event.altKey && hotkey !== "alt") || (event.shiftKey && hotkey !== "shift")) {
      cancel()
      return
    }
    if (event.defaultPrevented || isEditableTarget(event.target))
      return
    start(hotkey, hovered ?? target.querySelector(`:hover:not(.${CONTENT_WRAPPER_CLASS})`))
  }
  const keyup = (event: KeyboardEvent) => {
    pressedKeys.delete(event.code || event.key)
    const hotkey = KEYBOARD_TRIGGERS[event.key as keyof typeof KEYBOARD_TRIGGERS]
    if (!press || press.hotkey !== hotkey) {
      cancel()
      return
    }
    clearTimeout(timer)
    timer = undefined
    const released = press
    press = null
    if (event.defaultPrevented || isEditableTarget(event.target)) {
      cancel()
      return
    }
    released.trigger()
  }
  const mousedown = (event: MouseEvent) => {
    cancel()
    if (event.button !== 0 || event.defaultPrevented || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || isEditableTarget(event.target))
      return
    const element = event.composedPath()[0]
    if (!(element instanceof Element) || element.closest("button,a,[role='button']"))
      return
    mouseStart = { x: event.clientX, y: event.clientY }
    start("clickAndHold", element)
  }
  const unwatch = watchLocalConfig((next, previous) => {
    if (!next?.features.hoverTranslation || (previous && (
      next.features.hoverStream !== previous.features.hoverStream
      || next.translate.mode !== previous.translate.mode
      || next.translate.providerId !== previous.translate.providerId
      || next.language.sourceCode !== previous.language.sourceCode
      || next.language.targetCode !== previous.language.targetCode
      || JSON.stringify(next.providersConfig) !== JSON.stringify(previous.providersConfig)
    ))) {
      reset()
      activeTranslation?.abort()
    }
  })
  target.addEventListener("mouseover", move, true)
  target.addEventListener("mousemove", move, true)
  target.addEventListener("keydown", keydown, true)
  target.addEventListener("keyup", keyup, true)
  target.addEventListener("mousedown", mousedown, true)
  target.addEventListener("mouseup", cancel, true)
  target.addEventListener("dragstart", cancel, true)
  target.addEventListener("contextmenu", cancel, true)
  target.addEventListener("visibilitychange", reset)
  target.defaultView?.addEventListener("blur", reset)
  return () => {
    unwatch()
    reset()
    activeTranslation?.abort()
    controller.abort()
    target.removeEventListener("mouseover", move, true)
    target.removeEventListener("mousemove", move, true)
    target.removeEventListener("keydown", keydown, true)
    target.removeEventListener("keyup", keyup, true)
    target.removeEventListener("mousedown", mousedown, true)
    target.removeEventListener("mouseup", cancel, true)
    target.removeEventListener("dragstart", cancel, true)
    target.removeEventListener("contextmenu", cancel, true)
    target.removeEventListener("visibilitychange", reset)
    target.defaultView?.removeEventListener("blur", reset)
  }
}
