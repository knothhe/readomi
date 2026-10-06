import { browser } from "#imports"
import { getLocalConfig, watchLocalConfig } from "@/utils/config/storage"
import { logger } from "@/utils/logger"
import { isSiteDisabled } from "@/utils/site-disable"
import { getPageTranslationEnabled, setPageTranslationEnabled } from "./page-translation-state"

export async function isTabSiteDisabled(tabId: number): Promise<boolean> {
  const config = await getLocalConfig()
  if (!config?.features.disabledSites.length)
    return false
  const tab = await browser.tabs.get(tabId)
  return isSiteDisabled(tab.url ?? "", config)
}

/** Clear remembered translation and its toolbar icon for every affected open tab. */
export function setupSiteDisable(notifyPageTranslationStateChanged: (tabId: number, enabled: boolean) => void) {
  watchLocalConfig((config, previous) => {
    if (JSON.stringify(config?.features.disabledSites) === JSON.stringify(previous?.features.disabledSites))
      return
    void browser.tabs.query({}).then(async (tabs) => {
      await Promise.all(tabs.map(async (tab) => {
        if (tab.id === undefined || !isSiteDisabled(tab.url ?? "", config) || !await getPageTranslationEnabled(tab.id))
          return
        await setPageTranslationEnabled(tab.id, false)
        notifyPageTranslationStateChanged(tab.id, false)
      }))
    }).catch(error => logger.warn("Failed to disable website translation state:", error))
  })
}
