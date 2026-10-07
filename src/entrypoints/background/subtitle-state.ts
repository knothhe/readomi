import type { PageSubtitleState } from "@/types/page-subtitle-state"
import { browser, storage } from "#imports"
import { getLocalConfig, watchLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { logger } from "@/utils/logger"
import { onMessage, sendMessage } from "@/utils/message"
import { isSiteDisabled } from "@/utils/site-disable"
import { subtitlePageKey } from "@/utils/subtitles/page-state"
import { isVideoTranslationExcluded } from "@/utils/subtitles/video-site-rules"

interface PageChoice { page: string, enabled: boolean }
const key = (tabId: number) => `session:pageSubtitles:${tabId}` as const

export function setupSubtitleState() {
  const writes = new Map<number, Promise<unknown>>()
  function enqueue<T>(tabId: number, action: () => Promise<T>): Promise<T> {
    const write = (writes.get(tabId) ?? Promise.resolve()).catch(() => {}).then(action)
    writes.set(tabId, write)
    void write.finally(() => {
      if (writes.get(tabId) === write)
        writes.delete(tabId)
    }).catch(() => {})
    return write
  }
  async function read(tabId: number, expectedUrl?: string): Promise<PageSubtitleState> {
    const tab = await browser.tabs.get(tabId)
    const url = tab.url ?? ""
    if (!/^(?:https?|file):/i.test(url))
      return { url, enabled: false, available: false, overridden: false }
    if (expectedUrl && subtitlePageKey(expectedUrl) !== subtitlePageKey(url))
      throw new Error("The page changed. Reopen the popup and try again.")
    const config = await getLocalConfig() ?? DEFAULT_CONFIG
    const available = !isSiteDisabled(url, config) && !isVideoTranslationExcluded(url, config.features.videoExcludedSites)
    const choice = await storage.getItem<PageChoice>(key(tabId))
    const overridden = available && choice?.page === subtitlePageKey(url)
    if (choice && (!available || !overridden))
      await storage.removeItem(key(tabId))
    return { url, available, overridden, enabled: available && (overridden ? choice!.enabled : config.features.videoSubtitles) }
  }
  onMessage("getPageSubtitleState", ({ data, sender }) => {
    const tabId = sender?.url?.startsWith(browser.runtime.getURL("/")) ? data?.tabId : sender?.tab?.id ?? data?.tabId
    if (tabId === undefined)
      throw new Error("No page is available")
    return read(tabId, data?.url)
  })
  onMessage("setPageSubtitleState", ({ data, sender }) => {
    const tabId = sender?.url?.startsWith(browser.runtime.getURL("/")) ? data.tabId : sender?.tab?.id ?? data.tabId
    if (tabId === undefined)
      throw new Error("No page is available")
    return enqueue(tabId, async () => {
      const previous = await read(tabId, data.url)
      if (!previous.available)
        throw new Error("Subtitle translation is unavailable on this page")
      const state = { ...previous, overridden: true, enabled: data.enabled ?? !previous.enabled }
      await storage.setItem<PageChoice>(key(tabId), { page: subtitlePageKey(state.url), enabled: state.enabled })
      try {
        await sendMessage("applyPageSubtitleState", state, tabId)
      }
      catch (error) {
        if (previous.overridden)
          await storage.setItem<PageChoice>(key(tabId), { page: subtitlePageKey(previous.url), enabled: previous.enabled })
        else
          await storage.removeItem(key(tabId))
        void sendMessage("applyPageSubtitleState", previous, tabId).catch(() => {})
        throw error
      }
      // The action popup can be closed; a missing receiver is expected.
      void sendMessage("pageSubtitleStateChanged", { tabId, state }).catch(() => {})
      return state
    })
  })
  // Disabled sites stop their content runtime, so clear their choices here too.
  watchLocalConfig((config, previous) => {
    if (JSON.stringify([config?.features.disabledSites, config?.features.videoExcludedSites]) === JSON.stringify([previous?.features.disabledSites, previous?.features.videoExcludedSites]))
      return
    const next = config ?? DEFAULT_CONFIG
    void browser.tabs.query({}).then(tabs => Promise.all(tabs.map((tab) => {
      if (tab.id === undefined || !/^(?:https?|file):/i.test(tab.url ?? ""))
        return undefined
      const tabId = tab.id
      return enqueue(tabId, async () => {
        if (isSiteDisabled(tab.url ?? "", next) || isVideoTranslationExcluded(tab.url ?? "", next.features.videoExcludedSites))
          await storage.removeItem(key(tabId))
        const state = await read(tabId)
        // The popup may mount optimistically before a website rule is saved.
        // Send its committed value after both disabling and reenabling.
        void sendMessage("applyPageSubtitleState", state, tabId).catch(() => {})
        void sendMessage("pageSubtitleStateChanged", { tabId, state }).catch(() => {})
      })
    }))).catch(error => logger.warn("Could not update page subtitle availability", error))
  })
  browser.tabs.onRemoved.addListener(tabId => storage.removeItem(key(tabId)))
  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0)
      void storage.removeItem(key(details.tabId))
  })
  browser.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
    if (details.frameId !== 0 || !/^(?:https?|file):/i.test(details.url))
      return
    try {
      await enqueue(details.tabId, async () => {
        // SPA navigation can keep embedded runtimes alive. Reconcile against
        // the new page and publish its effective state to every existing frame.
        const state = await read(details.tabId, details.url)
        void sendMessage("applyPageSubtitleState", state, details.tabId).catch(() => {})
        void sendMessage("pageSubtitleStateChanged", { tabId: details.tabId, state }).catch(() => {})
      })
    }
    catch (error) {
      logger.warn("Could not update page subtitles after history navigation", error)
    }
  })
}
