import type { PageTranslationManager } from "./page-translation"
import type { Config } from "@/types/config/config"
import { watchLocalConfig } from "@/utils/config/storage"

/**
 * Handles config changes and re-translates page when translation mode changes
 * while page translation is active.
 */
export function handleTranslationModeChange(
  newConfig: Config | null,
  oldConfig: Config | null,
  manager: PageTranslationManager,
): void {
  const modeChanged = newConfig && oldConfig && newConfig.translate.mode !== oldConfig.translate.mode
  const rulesChanged = newConfig && oldConfig && JSON.stringify(newConfig.siteRules) !== JSON.stringify(oldConfig.siteRules)

  // restart() keeps the page translation on for the tab: unlike stop(), it does not tell the background that translation is off.
  if ((modeChanged || rulesChanged) && manager.isActive) {
    void manager.restart()
  }
}

/**
 * Watches the stored config for changes from the popup or the options page.
 * Returns the function that stops the watch.
 */
export function watchConfigChanges(manager: PageTranslationManager): () => void {
  return watchLocalConfig((newConfig, oldConfig) => {
    handleTranslationModeChange(newConfig, oldConfig, manager)
  })
}
