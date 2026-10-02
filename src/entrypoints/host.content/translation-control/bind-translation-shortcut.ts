import type { PageTranslationManager } from "./page-translation"
import { getDefaultStore } from "jotai"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getLocalConfig, watchLocalConfig } from "@/utils/config/storage"
import { eventMatchesHotkey, isEditableTarget } from "@/utils/hotkeys"
import { logger } from "@/utils/logger"
import { isPageTranslationShortcutEmpty, isValidConfiguredPageTranslationShortcut } from "@/utils/page-translation-shortcut"

/**
 * Toggles page translation on the configured shortcut. Typing into a field
 * never triggers it, and a matched press does not reach the page.
 */
export async function bindTranslationShortcutKey(pageTranslationManager: PageTranslationManager, target: Document = document, isContextInvalid: () => boolean = () => false) {
  let config = await getLocalConfig()
  if (isContextInvalid())
    return () => {}
  const unwatch = watchLocalConfig(next => config = next)

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
    if (pageTranslationManager.isActive) {
      pageTranslationManager.stop()
    }
    else {
      void pageTranslationManager.start()
    }
  }

  target.addEventListener("keydown", onKeyDown, true)
  return () => {
    unwatch()
    target.removeEventListener("keydown", onKeyDown, true)
  }
}
