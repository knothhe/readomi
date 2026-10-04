import type { LangCodeISO6393 } from "@/definitions"
import type { Config } from "@/types/config/config"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { isExtensionContextInvalidatedError, isExtensionContextValid } from "@/utils/extension-context"
import { flushBatchedOperations } from "@/utils/host/dom/batch-dom"
import { hasNoWalkAncestor, isDontWalkIntoAndDontTranslateAsChildElement, isHTMLElement, isWalkBlockedElement, isWithinIncludeScope } from "@/utils/host/dom/filter"
import { findNearestAncestorBlockNodeFor } from "@/utils/host/dom/find"
import { matchesSiteRuleSelector } from "@/utils/host/dom/site-rule-matching"
import { getTranslationGroup, getTranslationGroupOwner } from "@/utils/host/dom/translation-group"
import { extractTextContent, walkAndLabelElement } from "@/utils/host/dom/traversal"
import { containsInlineAtomOutsideWrappers } from "@/utils/host/translate/dom/inline-atoms"
import { removeAllTranslatedWrapperNodes, translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { validateTranslationConfigAndToast } from "@/utils/host/translate/translate-text"
import { translateTextForPage } from "@/utils/host/translate/translate-variants"
import { createInlineHoverStreamPreview } from "@/utils/host/translate/ui/inline-hover-stream-preview"
import { beginSiteRuleStyleOperation } from "@/utils/host/translate/ui/site-rule-styles"
import { isEditableTarget } from "@/utils/hotkeys"
import { logger } from "@/utils/logger"
import { getEffectiveSiteRule } from "@/utils/site-rules/effective"
import { getHostConfig, getHostPreviewContext, watchHostConfig } from "@/utils/site-rules/preview-config"
import { describePreviewElement, recordSiteRulePreview } from "@/utils/site-rules/preview-observations"

const KEYBOARD_TRIGGERS = { "Alt": "alt", "Control": "control", "Shift": "shift", "`": "backtick" } as const

/** Read Frog's tap-or-hold keyboard interaction and mouse hold, using the paragraph renderer. */
export function bindHoverTranslation(target: Document = document) {
  const keyboardTarget = target.defaultView ?? target
  let currentConfig: Config | null = null
  let configChanged = false
  let consumedKey: string | null = null
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
    const context = getHostPreviewContext()
    const record = (event: Parameters<typeof recordSiteRulePreview>[0]) => recordSiteRulePreview({ ...event, ...context })
    const block = findNearestAncestorBlockNodeFor(element, config)
    const hit = {
      target: describePreviewElement(element), block: describePreviewElement(block),
      targetDisplay: element.ownerDocument.defaultView?.getComputedStyle(element).display,
      blockDisplay: block.ownerDocument.defaultView?.getComputedStyle(block).display,
      root: block.getRootNode() instanceof ShadowRoot ? "shadow" as const : "document" as const,
    }
    record({ event: "hover-target", ...hit })
    if (!isHTMLElement(block) || block === target.body || block === target.documentElement || hasNoWalkAncestor(block, config)
      || block.closest("input,textarea,[contenteditable]:not([contenteditable='false']),video,[data-readomi-subtitles]") || !block.textContent?.trim()) {
      const rule = getEffectiveSiteRule(config, window.location.href)
      let ancestor: HTMLElement | null = isHTMLElement(block) ? block.parentElement : null
      while (ancestor && !isWalkBlockedElement(ancestor, config))
        ancestor = ancestor.parentElement
      record({ event: "hover-blocked", ...hit,
        target: ancestor ? describePreviewElement(ancestor) : hit.target,
        selector: ancestor && matchesSiteRuleSelector(ancestor, rule.excludeSelector)
          ? rule.excludeSelector
          : ancestor && matchesSiteRuleSelector(ancestor, rule.preserveTextSelector) ? rule.preserveTextSelector : null,
        reason: ancestor ? "blocked ancestor" : "empty, editable, media or document target",
      })
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
    const styleRoot = block.getRootNode()
    const releaseStyles = beginSiteRuleStyleOperation(styleRoot instanceof ShadowRoot ? styleRoot : block.ownerDocument, config)
    try {
      // Formula placeholders are internal to the translation request. Wait for
      // the complete renderer so a streaming preview never exposes them.
      preview = config.features.hoverStream && !containsInlineAtomOutsideWrappers(block, config)
        ? createInlineHoverStreamPreview(block, config, () => request.abort())
        : undefined
      const walkId = getRandomUUID()
      walkAndLabelElement(block, walkId, config)
      const requests: { result: Promise<string>, resolve: (text: string) => void, reject: (error: unknown) => void }[] = []
      const translateGroup = Object.assign((text: string, typographyElement?: HTMLElement, hideSpinner?: () => void, onTargetLanguage?: (code: LangCodeISO6393) => void) => {
        const requestTarget = typographyElement ? describePreviewElement(typographyElement) : hit.block
        record({ event: "request-started", target: requestTarget })
        const update = preview?.register(typographyElement, hideSpinner)
        let streamed = false
        const onPartial = update && ((partial: string) => {
          if (partial && !streamed) {
            streamed = true
            record({ event: "stream-started", target: requestTarget })
          }
          // A replacement preview spans the whole paragraph. If that paragraph
          // has several language units, keep it intact until all units settle.
          if (config.translate.mode !== "translationOnly" || requests.length <= 1)
            update(partial)
        })
        const onTarget = (code: LangCodeISO6393) => {
          update?.setTargetLanguage(code)
          onTargetLanguage?.(code)
        }
        const result = new Promise<string>((resolve, reject) => {
          const abort = () => {
            record({ event: "request-cancelled", target: requestTarget })
            reject(new DOMException("Translation cancelled", "AbortError"))
          }
          signal.addEventListener("abort", abort, { once: true })
          void translateTextForPage(text, { onPartial, onTargetLanguage: onTarget, signal }).then((value) => {
            if (!signal.aborted)
              record({ event: "request-completed", target: requestTarget, reason: value ? "translated" : "preserved or empty" })
            resolve(value)
          }, (error) => {
            if (!signal.aborted)
              record({ event: "request-failed", target: requestTarget, reason: error instanceof Error ? error.name : "translation error" })
            reject(error)
          }).finally(() => signal.removeEventListener("abort", abort))
        })
        return new Promise<string>((resolve, reject) => requests.push({ result, resolve, reject }))
      }, { showSpinner: true, cancel: () => request.abort() })
      const finished = translateWalkedElement(block, walkId, config, true, signal, translateGroup)
      if (!requests.length) {
        const rule = getEffectiveSiteRule(config, window.location.href)
        record({ event: "hover-no-content", ...hit, selector: rule.includeSelector, reason: "No translation group survived include/exclude, preserved-text or length filtering." })
      }
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
      releaseStyles()
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
      void getHostConfig().then(async (config) => {
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
  const resetKeyboard = () => {
    consumedKey = null
    reset()
  }
  const consume = (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const canConsumeBacktick = (event: KeyboardEvent, element: Element | null) => {
    const config = currentConfig
    if (!config?.features.hoverTranslation || config.features.hoverHotkey !== "backtick"
      || !element?.isConnected || press || busy || controller.signal.aborted || !isExtensionContextValid()
      || event.isComposing || event.composedPath().some(isEditableTarget) || isEditableTarget(target.activeElement)) {
      return false
    }
    const block = findNearestAncestorBlockNodeFor(element, config)
    if (!isHTMLElement(block) || block === target.body || block === target.documentElement
      || hasNoWalkAncestor(block, config) || isWalkBlockedElement(block, config)
      || block.closest("input,textarea,[contenteditable]:not([contenteditable='false']),video,[data-readomi-subtitles]")
      || !block.textContent?.trim()) {
      return false
    }
    const group = getTranslationGroup(block, config)
    if (!group) {
      return isWithinIncludeScope(block, config)
        || (isHTMLElement(element) && isWithinIncludeScope(element, config))
    }
    // The owner may sit outside the paragraph whitelist (e.g. a Reddit card).
    // Only its declared, readable sources make it eligible for translation.
    if (group.sources.some(source => !hasNoWalkAncestor(source, config)
      && !isWalkBlockedElement(source, config) && !!extractTextContent(source, config).trim())) {
      return true
    }
    // Translation-only results hide their live sources. Keep the visible owned
    // result eligible so another press can restore those original sources.
    const results = group.placement === "append" ? [...block.children] : [block.nextElementSibling]
    return results.some(result => result && isHTMLElement(result) && getTranslationGroupOwner(result) === block
      && !hasNoWalkAncestor(result, config) && !isDontWalkIntoAndDontTranslateAsChildElement(result, config)
      && !!result.textContent?.trim())
  }
  const keydown = (event: KeyboardEvent) => {
    if (consumedKey === (event.code || event.key)) {
      consume(event)
      return
    }
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
    const element = hovered ?? target.querySelector(`:hover:not(.${CONTENT_WRAPPER_CLASS})`)
    if (hotkey === "backtick") {
      if (!canConsumeBacktick(event, element))
        return
      // Decide synchronously, before the page can route this character into
      // its editor. Keep ownership through repeat and release, even on cancel.
      consumedKey = event.code || event.key
      consume(event)
    }
    start(hotkey, element)
  }
  const keyup = (event: KeyboardEvent) => {
    const consumed = consumedKey === (event.code || event.key)
    if (consumed) {
      consumedKey = null
      consume(event)
    }
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
    if ((!consumed && event.defaultPrevented) || isEditableTarget(event.target)) {
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
  const unwatch = watchHostConfig((next, previous) => {
    currentConfig = next
    configChanged = true
    const rulesChanged = previous && JSON.stringify(next?.siteRules) !== JSON.stringify(previous.siteRules)
    const languageChanged = previous && JSON.stringify(next?.language) !== JSON.stringify(previous.language)
    const promptChanged = previous && JSON.stringify(next?.translate.customPromptsConfig) !== JSON.stringify(previous.translate.customPromptsConfig)
    if (rulesChanged || languageChanged || promptChanged)
      removeAllTranslatedWrapperNodes(target)
    if (!next?.features.hoverTranslation || rulesChanged || languageChanged || promptChanged || (previous && (
      next.features.hoverStream !== previous.features.hoverStream
      || next.translate.mode !== previous.translate.mode
      || next.translate.providerId !== previous.translate.providerId
      || JSON.stringify(next.providersConfig) !== JSON.stringify(previous.providersConfig)
    ))) {
      reset()
      activeTranslation?.abort()
    }
  })
  // Watch first: a delayed initial read must not overwrite a newer setting.
  void getHostConfig().then((config) => {
    if (!configChanged && !controller.signal.aborted && isExtensionContextValid())
      currentConfig = config
  }).catch((error) => {
    if (!controller.signal.aborted && isExtensionContextValid() && !isExtensionContextInvalidatedError(error))
      logger.error("Hover configuration failed", error)
  })
  const handleRouteChange = () => {
    reset()
    activeTranslation?.abort()
    removeAllTranslatedWrapperNodes(target)
  }
  target.defaultView?.addEventListener("extension:URLChange", handleRouteChange)
  target.addEventListener("mouseover", move, true)
  target.addEventListener("mousemove", move, true)
  keyboardTarget.addEventListener("keydown", keydown as EventListener, true)
  keyboardTarget.addEventListener("keyup", keyup as EventListener, true)
  target.addEventListener("mousedown", mousedown, true)
  target.addEventListener("mouseup", cancel, true)
  target.addEventListener("dragstart", cancel, true)
  target.addEventListener("contextmenu", cancel, true)
  target.addEventListener("visibilitychange", resetKeyboard)
  target.defaultView?.addEventListener("blur", resetKeyboard)
  return () => {
    unwatch()
    resetKeyboard()
    activeTranslation?.abort()
    controller.abort()
    target.defaultView?.removeEventListener("extension:URLChange", handleRouteChange)
    target.removeEventListener("mouseover", move, true)
    target.removeEventListener("mousemove", move, true)
    keyboardTarget.removeEventListener("keydown", keydown as EventListener, true)
    keyboardTarget.removeEventListener("keyup", keyup as EventListener, true)
    target.removeEventListener("mousedown", mousedown, true)
    target.removeEventListener("mouseup", cancel, true)
    target.removeEventListener("dragstart", cancel, true)
    target.removeEventListener("contextmenu", cancel, true)
    target.removeEventListener("visibilitychange", resetKeyboard)
    target.defaultView?.removeEventListener("blur", resetKeyboard)
  }
}
