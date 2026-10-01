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

/** Read Frog's held-modifier interaction, using the existing paragraph renderer. */
export function bindHoverTranslation(target: Document = document) {
  let hovered: Element | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let session = 0
  let held = false
  let busy = false
  let mouseStart: { x: number, y: number } | null = null
  const controller = new AbortController()
  const cancel = () => {
    session++
    held = false
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
    if (!element || held || busy)
      return
    held = true
    const token = ++session
    timer = setTimeout(() => {
      void getLocalConfig().then((config) => {
        if (config?.features.hoverTranslation && config.features.hoverHotkey === hotkey && token === session && !controller.signal.aborted && element.isConnected)
          return translate(element, config)
      }).catch(error => logger.error("Hover configuration failed", error))
    }, 500)
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.repeat)
      return
    const hotkey = ({ "Alt": "alt", "Control": "control", "Shift": "shift", "`": "backtick" } as const)[event.key as "Alt" | "Control" | "Shift" | "`"]
    if (!hotkey || event.metaKey || (event.ctrlKey && hotkey !== "control") || (event.altKey && hotkey !== "alt") || (event.shiftKey && hotkey !== "shift")) {
      cancel()
      return
    }
    if (event.defaultPrevented || isEditableTarget(event.target))
      return
    start(hotkey, hovered ?? target.querySelector(`:hover:not(.${CONTENT_WRAPPER_CLASS})`))
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
  target.addEventListener("keyup", cancel, true)
  target.addEventListener("mousedown", mousedown, true)
  target.addEventListener("mouseup", cancel, true)
  target.addEventListener("dragstart", cancel, true)
  target.addEventListener("contextmenu", cancel, true)
  target.addEventListener("visibilitychange", cancel)
  target.defaultView?.addEventListener("blur", cancel)
  return () => {
    cancel()
    controller.abort()
    target.removeEventListener("mouseover", move, true)
    target.removeEventListener("mousemove", move, true)
    target.removeEventListener("keydown", keydown, true)
    target.removeEventListener("keyup", cancel, true)
    target.removeEventListener("mousedown", mousedown, true)
    target.removeEventListener("mouseup", cancel, true)
    target.removeEventListener("dragstart", cancel, true)
    target.removeEventListener("contextmenu", cancel, true)
    target.removeEventListener("visibilitychange", cancel)
    target.defaultView?.removeEventListener("blur", cancel)
  }
}
