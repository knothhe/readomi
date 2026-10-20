import type { PageSubtitleState } from "@/types/page-subtitle-state"
import { browser, storage } from "#imports"
import { getLocalConfig, watchLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { logger } from "@/utils/logger"
import { onMessage, sendMessage } from "@/utils/message"
import { isSiteDisabled } from "@/utils/site-disable"
import { subtitleSiteKey } from "@/utils/subtitles/page-state"
import { isVideoTranslationExcluded } from "@/utils/subtitles/video-site-rules"

const key = (url: string) => `local:siteSubtitles:${encodeURIComponent(subtitleSiteKey(url))}` as const
const supported = (url: string) => /^(?:https?|file):/i.test(url)

export function setupSubtitleState() {
  // All popup and frame writers share one background queue, including tabs
  // on the same domain. Readers never observe an unconfirmed write.
  let writes: Promise<unknown> = Promise.resolve()
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const write = writes.catch(() => {}).then(action)
    writes = write
    return write
  }
  async function read(tabId: number, expectedUrl?: string): Promise<PageSubtitleState> {
    const tab = await browser.tabs.get(tabId)
    const url = tab.url ?? ""
    if (!supported(url))
      return { url, enabled: false, available: false, overridden: false }
    if (expectedUrl && subtitleSiteKey(expectedUrl) !== subtitleSiteKey(url))
      throw new Error("The page changed. Reopen the popup and try again.")
    const config = await getLocalConfig() ?? DEFAULT_CONFIG
    const disabled = isSiteDisabled(url, config)
    const excluded = isVideoTranslationExcluded(url, config.features.videoExcludedSites)
    const available = !disabled && !excluded
    const choice = await storage.getItem<boolean>(key(url))
    const overridden = typeof choice === "boolean"
    const selectedEnabled = overridden ? choice : config.features.videoSubtitles
    return { url, available, overridden: available && overridden, enabled: available && selectedEnabled, ...(!available ? { selectedEnabled } : {}) }
  }
  async function publish(tabId: number, state: PageSubtitleState) {
    await sendMessage("applyPageSubtitleState", state, tabId).catch(() => {})
    await sendMessage("pageSubtitleStateChanged", { tabId, state }).catch(() => {})
  }
  async function publishTabs(site?: string, exceptTabId?: number) {
    const tabs = await browser.tabs.query({})
    for (const tab of tabs) {
      if (tab.id === undefined || tab.id === exceptTabId || !supported(tab.url ?? "") || (site && subtitleSiteKey(tab.url!) !== site))
        continue
      // A closed or navigated tab cannot prevent other tabs from updating.
      try {
        await publish(tab.id, await read(tab.id))
      }
      catch (error) {
        logger.warn("Could not update site subtitles in a tab", error)
      }
    }
  }
  onMessage("getPageSubtitleState", ({ data, sender }) => {
    const tabId = sender?.url?.startsWith(browser.runtime.getURL("/")) ? data?.tabId : sender?.tab?.id ?? data?.tabId
    if (tabId === undefined)
      throw new Error("No page is available")
    return enqueue(() => read(tabId, data?.url))
  })
  onMessage("setPageSubtitleState", ({ data, sender }) => {
    const tabId = sender?.url?.startsWith(browser.runtime.getURL("/")) ? data.tabId : sender?.tab?.id ?? data.tabId
    if (tabId === undefined)
      throw new Error("No page is available")
    return enqueue(async () => {
      const previous = await read(tabId, data.url)
      if (!previous.available)
        throw new Error("Subtitle translation is unavailable on this page")
      const state = { ...previous, overridden: true, enabled: data.enabled ?? !previous.enabled }
      const storageKey = key(state.url)
      const previousChoice = await storage.getItem<boolean>(storageKey)
      await storage.setItem(storageKey, state.enabled)
      try {
        await sendMessage("applyPageSubtitleState", state, tabId)
      }
      catch (error) {
        if (typeof previousChoice === "boolean")
          await storage.setItem(storageKey, previousChoice)
        else
          await storage.removeItem(storageKey)
        await publish(tabId, previous)
        throw error
      }
      // Closed popups and tabs without a running content script are expected.
      await sendMessage("pageSubtitleStateChanged", { tabId, state }).catch(() => {})
      await publishTabs(subtitleSiteKey(state.url), tabId).catch(error => logger.warn("Could not update other tabs after saving site subtitles", error))
      return state
    })
  })
  // Availability and the global fallback can change while a site is paused.
  // Preserve its saved domain choice through exclusions and pauses.
  watchLocalConfig((config, previous) => {
    const relevant = (value: typeof config) => [value?.features.videoSubtitles, value?.features.disabledSites, value?.features.videoExcludedSites]
    if (JSON.stringify(relevant(config)) === JSON.stringify(relevant(previous)))
      return
    void enqueue(() => publishTabs()).catch(error => logger.warn("Could not update site subtitle availability", error))
  })
  browser.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
    if (details.frameId !== 0 || !supported(details.url))
      return
    try {
      await enqueue(async () => publish(details.tabId, await read(details.tabId, details.url)))
    }
    catch (error) {
      logger.warn("Could not update site subtitles after history navigation", error)
    }
  })
}
