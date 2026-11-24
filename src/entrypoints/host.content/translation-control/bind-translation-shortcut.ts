import type { PageTranslationManager } from "./page-translation"
import { getDefaultStore } from "jotai"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { eventMatchesHotkey, isEditableTarget } from "@/utils/hotkeys"
import { logger } from "@/utils/logger"
import { onMessage, sendMessage } from "@/utils/message"
import { isPageTranslationShortcutEmpty, isValidConfiguredPageTranslationShortcut } from "@/utils/page-translation-shortcut"
import { getHostConfig, watchHostConfig } from "@/utils/site-rules/preview-config"

/**
 * Toggles page translation on the configured shortcut. Typing into a field
 * never triggers it, and a matched press does not reach the page.
 */
export async function bindTranslationShortcutKey(pageTranslationManager: PageTranslationManager | null, target: Document = document, isContextInvalid: () => boolean = () => false) {
  let config = await getHostConfig()
  if (isContextInvalid())
    return () => {}
  const unwatch = watchHostConfig(next => config = next)

  const toggle = () => {
    if (isContextInvalid() || !pageTranslationManager)
      return
    if (pageTranslationManager.isActive) {
      pageTranslationManager.stop()
    }
    else {
      void pageTranslationManager.start()
    }
  }
  const off = window === window.top ? onMessage("topPageShortcut", toggle) : () => {}
  const onKeyDown = (event: KeyboardEvent) => {
    if (isContextInvalid())
      return
    if (!config || event.defaultPrevented || event.repeat || isEditableTarget(event.target))
      return
    const modeShortcut = config.features.modeShortcut
    if (modeShortcut && eventMatchesHotkey(event, modeShortcut)) {
      event.preventDefault()
      event.stopPropagation()
      void getDefaultStore().set(configFieldsAtomMap.translate, { mode: config.translate.mode === "bilingual" ? "translationOnly" : "bilingual" }).catch((error) => {
        if (!isContextInvalid())
          logger.error("Could not switch translation mode", error)
      })
      return
    }
    const shortcut = config.translate.page.shortcut
    if (isPageTranslationShortcutEmpty(shortcut) || !isValidConfiguredPageTranslationShortcut(shortcut) || !eventMatchesHotkey(event, shortcut))
      return
    event.preventDefault()
    event.stopPropagation()
    if (window === window.top)
      toggle()
    else if (event.isTrusted)
      void sendMessage("framePageShortcut").catch(() => {})
  }

  target.addEventListener("keydown", onKeyDown, true)
  return () => {
    off()
    unwatch()
    target.removeEventListener("keydown", onKeyDown, true)
  }
}
