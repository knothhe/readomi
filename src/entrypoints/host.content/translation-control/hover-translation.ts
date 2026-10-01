import type { Config } from "@/types/config/config"
import { getLocalConfig } from "@/utils/config/storage"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { hasNoWalkAncestor, isHTMLElement } from "@/utils/host/dom/filter"
import { findNearestAncestorBlockNodeFor } from "@/utils/host/dom/find"
import { walkAndLabelElement } from "@/utils/host/dom/traversal"
import { translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { validateTranslationConfigAndToast } from "@/utils/host/translate/translate-text"
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
    busy = true
    try {
      const walkId = getRandomUUID()
      walkAndLabelElement(block, walkId, config)
      await translateWalkedElement(block, walkId, config, true, controller.signal)
    }
    catch (error) {
      logger.error("Hover translation failed", error)
    }
    finally {
      busy = false
    }
  }
  const start = (hotkey: Config["features"]["hoverHotkey"], element: Element | null) => {
    if (!element || press || busy)
      return
    const token = ++session
    let triggered = false
    const trigger = () => {
      // Claim the press before reading storage, so keyup cannot trigger it twice.
      if (triggered)
        return
      triggered = true
      const candidate = hotkey === "clickAndHold" ? element : hovered ?? element
      void getLocalConfig().then((config) => {
        if (config?.features.hoverTranslation && config.features.hoverHotkey === hotkey && token === session && !busy && !controller.signal.aborted && candidate.isConnected)
          return translate(candidate, config)
      }).catch(error => logger.error("Hover configuration failed", error))
    }
    press = { hotkey, trigger }
    timer = setTimeout(trigger, 500)
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.repeat)
      return
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
  const reset = () => {
    pressedKeys.clear()
    cancel()
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
    reset()
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
