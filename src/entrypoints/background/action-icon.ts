import type { ColorTheme } from "@/utils/color-theme"
import { browser } from "#imports"
import { getThemeIconPath } from "@/utils/color-theme"
import { watchLocalConfig } from "@/utils/config/storage"
import { logger } from "@/utils/logger"
import { ensureInitializedConfig } from "./config"
import { getPageTranslationState, isPageTranslationStateInUrlScope } from "./page-translation-state"

function iconPaths(color: ColorTheme, translated = false) {
  return { 16: getThemeIconPath(color, 16, translated), 32: getThemeIconPath(color, 32, translated) }
}

// Serialize theme refreshes and translation changes; a slower previous choice cannot overwrite a newer one.
let updates: Promise<void> = Promise.resolve()
function enqueue(update: () => Promise<void>): Promise<void> {
  updates = updates.then(update).catch(error => logger.warn("Failed to update action icon", error))
  return updates
}

export function updateActionIcon(tabId: number, active: boolean): Promise<void> {
  return enqueue(async () => {
    const config = await ensureInitializedConfig()
    await browser.action.setIcon({ tabId, path: iconPaths(config?.appearance.colorTheme ?? "terra", active) })
  })
}

/** Update the global default and every tab override, keeping translated tabs' check marks. */
export function refreshActionIcons(): Promise<void> {
  return enqueue(async () => {
    const config = await ensureInitializedConfig()
    const color = config?.appearance.colorTheme ?? "terra"
    await browser.action.setIcon({ path: iconPaths(color) })
    const tabs = await browser.tabs.query({})
    await Promise.all(tabs.map(async (tab) => {
      if (tab.id === undefined)
        return
      try {
        const translated = isPageTranslationStateInUrlScope(await getPageTranslationState(tab.id), tab.url)
        await browser.action.setIcon({ tabId: tab.id, path: iconPaths(color, translated) })
      }
      catch {
        // A tab may close while its stored state is being read.
      }
    }))
  })
}

export function setupActionIcons() {
  watchLocalConfig((next, previous) => {
    if (next?.appearance.colorTheme !== previous?.appearance.colorTheme)
      void refreshActionIcons()
  })
  // Runs whenever the MV3 worker starts again: stored theme and tab states are restored.
  void refreshActionIcons()
}
