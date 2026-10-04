import type { PageTranslationManager } from "./page-translation"
import type { Config } from "@/types/config/config"
import { watchHostConfig } from "@/utils/site-rules/preview-config"

/**
 * Apply display, language and prompt changes to an active translation session.
 */
export function handleTranslationModeChange(
  newConfig: Config | null,
  oldConfig: Config | null,
  manager: PageTranslationManager,
): void {
  const modeChanged = newConfig && oldConfig && newConfig.translate.mode !== oldConfig.translate.mode
  const rulesChanged = newConfig && oldConfig && JSON.stringify(newConfig.siteRules) !== JSON.stringify(oldConfig.siteRules)
  const languageChanged = newConfig && oldConfig && JSON.stringify(newConfig.language) !== JSON.stringify(oldConfig.language)
  const promptChanged = newConfig && oldConfig && JSON.stringify(newConfig.translate.customPromptsConfig) !== JSON.stringify(oldConfig.translate.customPromptsConfig)

  // restart() keeps the page translation on for the tab: unlike stop(), it does not tell the background that translation is off.
  if ((modeChanged || rulesChanged || languageChanged || promptChanged) && manager.isActive) {
    void manager.restart()
  }
}

/**
 * Watches the stored config for changes from the popup or the options page.
 * Returns the function that stops the watch.
 */
export function watchConfigChanges(manager: PageTranslationManager): () => void {
  return watchHostConfig((newConfig, oldConfig) => {
    handleTranslationModeChange(newConfig, oldConfig, manager)
  })
}
