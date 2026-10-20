import type { Browser } from "wxt/browser"
import type { Config } from "@/types/config/config"
import type { PageSubtitleState } from "@/types/page-subtitle-state"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { browser, storage } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"
import { setupSubtitleState } from "../subtitle-state"

const handlers = vi.hoisted(() => new Map<string, (message: { data?: { tabId?: number, url?: string, enabled?: boolean }, sender?: { tab: { id: number }, frameId?: number, url?: string } }) => Promise<PageSubtitleState>>())
const getConfig = vi.hoisted(() => vi.fn())
const watchConfig = vi.hoisted(() => vi.fn())
vi.mock("@/utils/config/storage", () => ({ getLocalConfig: getConfig, watchLocalConfig: watchConfig }))
vi.mock("@/utils/message", () => ({
  sendMessage: vi.fn(() => Promise.resolve()),
  onMessage: (name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(name, handler),
}))
let urls: Map<number, string>
let config: Config
const read = (tabId = 1) => handlers.get("getPageSubtitleState")!({ data: { tabId } })
const set = (enabled?: boolean, tabId = 1) => handlers.get("setPageSubtitleState")!({ data: { tabId, enabled } })
const siteKey = "local:siteSubtitles:www.youtube.com"
const navigate = () => vi.mocked(browser.webNavigation.onHistoryStateUpdated.addListener).mock.calls.at(-1)![0]

beforeEach(() => {
  fakeBrowser.reset()
  vi.clearAllMocks()
  handlers.clear()
  urls = new Map([[1, "https://www.youtube.com/watch?v=one"], [2, "https://www.youtube.com/watch?v=two"], [3, "https://x.com/home"]])
  config = DEFAULT_CONFIG
  getConfig.mockImplementation(async () => config)
  vi.spyOn(browser.tabs, "get").mockImplementation(async id => ({ id, url: urls.get(id) }) as Browser.tabs.Tab)
  vi.spyOn(browser.tabs, "query").mockImplementation(async () => Array.from(urls, ([id, url]) => ({ id, url })) as Browser.tabs.Tab[])
  vi.spyOn(browser.webNavigation.onHistoryStateUpdated, "addListener")
  setupSubtitleState()
})

describe("domain subtitle state", () => {
  it("shares a saved choice with the same domain and its embedded frames, leaving other domains alone", async () => {
    expect((await read()).enabled).toBe(false)
    const state = await set(true)
    expect(state).toMatchObject({ enabled: true, available: true, overridden: true })
    expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", state, 1)
    expect(sendMessage).toHaveBeenCalledWith("pageSubtitleStateChanged", { tabId: 1, state })
    expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", { ...state, url: urls.get(2) }, 2)
    expect(sendMessage).not.toHaveBeenCalledWith("applyPageSubtitleState", expect.anything(), 3)
    expect(await handlers.get("getPageSubtitleState")!({ sender: { tab: { id: 1 }, frameId: 3 } })).toEqual(state)
    expect((await read(2)).enabled).toBe(true)
    expect((await read(3)).enabled).toBe(false)
    expect(await storage.getItem(siteKey)).toBe(true)
    expect(config).toBe(DEFAULT_CONFIG)
  })
  it("serializes toggles from different tabs on the same domain", async () => {
    const states = await Promise.all([set(undefined, 1), set(undefined, 2), set(undefined, 1)])
    expect(states.map(state => state.enabled)).toEqual([true, false, true])
    expect((await read(2)).enabled).toBe(true)
  })
  it("targets the website when the extension popup is opened in its own tab", async () => {
    const state = await handlers.get("setPageSubtitleState")!({ data: { tabId: 1, enabled: true }, sender: { tab: { id: 99 }, url: browser.runtime.getURL("/popup.html") } })
    expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", state, 1)
    expect((await read(99)).available).toBe(false)
  })
  it("preserves explicit false through default changes, new videos, refresh and background restart", async () => {
    await set(false)
    config = { ...config, features: { ...config.features, videoSubtitles: true } }
    urls.set(1, "https://www.youtube.com/watch?v=three&t=50&list=playlist#chapter")
    expect(await read()).toMatchObject({ enabled: false, overridden: true })
    handlers.clear()
    setupSubtitleState()
    expect(await read()).toMatchObject({ enabled: false, overridden: true })
    urls.delete(1)
    urls.set(4, "https://www.youtube.com/shorts/four")
    expect(await read(4)).toMatchObject({ enabled: false, overridden: true })
  })
  it("uses exact hostnames, independently of scheme and port", async () => {
    await set(true)
    urls.set(2, "http://www.youtube.com:8080/embed/other")
    expect((await read(2)).enabled).toBe(true)
    urls.set(2, "https://youtube.com/watch?v=other")
    expect(await read(2)).toMatchObject({ enabled: false, overridden: false })
  })
  it("accepts a popup URL from another video on the same domain and checks the current page policy", async () => {
    urls.set(1, "https://www.youtube.com/watch?v=next")
    const state = await handlers.get("setPageSubtitleState")!({ data: { tabId: 1, url: "https://www.youtube.com/watch?v=one", enabled: true } })
    expect(state).toMatchObject({ url: urls.get(1), enabled: true, overridden: true })
  })
  it("keeps a successful domain save if querying other tabs fails", async () => {
    vi.mocked(browser.tabs.query).mockRejectedValueOnce(new Error("Tabs unavailable"))
    expect(await set(true)).toMatchObject({ enabled: true, overridden: true })
    expect(await storage.getItem(siteKey)).toBe(true)
    expect((await read(2)).enabled).toBe(true)
  })
  it("does not promote a legacy per-tab choice into a domain preference", async () => {
    await storage.setItem("session:pageSubtitles:1", { page: urls.get(1), enabled: true })
    expect(await read()).toMatchObject({ enabled: false, overridden: false })
  })
  it.each(["x.com", "twitter.com"])("preserves the %s choice through media views and other posts", async (host) => {
    const post = `https://${host}/example/status/100`
    urls.set(1, post)
    await set(true)
    for (const url of [`${post}/video/1`, `${post}/photo/2`, post, `https://${host}/other/status/200/video/1`, `https://${host}/home`]) {
      urls.set(1, url)
      await navigate()({ tabId: 1, frameId: 0, url } as Parameters<ReturnType<typeof navigate>>[0])
      expect(await read()).toMatchObject({ url, enabled: true, overridden: true })
    }
  })
  it("publishes the saved domain choice to surviving frames after SPA navigation and ignores frame navigation", async () => {
    await set(true)
    vi.mocked(sendMessage).mockClear()
    await navigate()({ tabId: 1, frameId: 3, url: "https://embedded.example/two" } as Parameters<ReturnType<typeof navigate>>[0])
    expect(sendMessage).not.toHaveBeenCalled()
    const url = "https://www.youtube.com/watch?v=three"
    urls.set(1, url)
    await navigate()({ tabId: 1, frameId: 0, url } as Parameters<ReturnType<typeof navigate>>[0])
    const state = { url, enabled: true, available: true, overridden: true }
    expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", state, 1)
    expect(sendMessage).toHaveBeenCalledWith("pageSubtitleStateChanged", { tabId: 1, state })
  })
  it.each(["disabled", "excluded"])("preserves the saved domain choice through %s sites", async (reason) => {
    await set(true)
    const previous = config
    config = { ...config, features: { ...config.features, disabledSites: reason === "disabled" ? ["www.youtube.com"] : [], videoExcludedSites: reason === "excluded" ? [{ type: "domain", value: "youtube.com" }] : [] } }
    watchConfig.mock.calls.at(-1)![0](config, previous)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("pageSubtitleStateChanged", { tabId: 1, state: expect.objectContaining({ enabled: false, available: false, selectedEnabled: true }) }))
    expect(await storage.getItem(siteKey)).toBe(true)
    await expect(set(false)).rejects.toThrow("unavailable")
    config = previous
    watchConfig.mock.calls.at(-1)![0](config, null)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("pageSubtitleStateChanged", { tabId: 1, state: expect.objectContaining({ enabled: true, available: true }) }))
    expect(await read()).toMatchObject({ enabled: true, overridden: true })
  })
  it("publishes a changed global fallback without replacing a saved domain choice", async () => {
    await set(false)
    const previous = config
    config = { ...config, features: { ...config.features, videoSubtitles: true } }
    watchConfig.mock.calls.at(-1)![0](config, previous)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", expect.objectContaining({ enabled: true, overridden: false }), 3))
    expect((await read()).enabled).toBe(false)
  })
  it.each(["disabled", "excluded", "restricted"])("does not allow a domain choice to bypass %s pages", async (reason) => {
    await set(true)
    if (reason === "restricted")
      urls.set(1, "chrome://extensions/")
    else
      config = { ...config, features: { ...config.features, disabledSites: reason === "disabled" ? ["www.youtube.com"] : [], videoExcludedSites: reason === "excluded" ? [{ type: "domain", value: "youtube.com" }] : [] } }
    expect(await read()).toMatchObject({ enabled: false, available: false })
    await expect(set(true)).rejects.toThrow("unavailable")
  })
  it("rejects stale popups and rolls back failed delivery without notifying other tabs", async () => {
    await expect(handlers.get("setPageSubtitleState")!({ data: { tabId: 1, url: "https://example.com/", enabled: true } })).rejects.toThrow("page changed")
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("No content script"))
    await expect(set(true)).rejects.toThrow("No content script")
    expect((await read(2)).enabled).toBe(false)
    expect(await storage.getItem(siteKey)).toBeNull()
    expect(sendMessage).not.toHaveBeenCalledWith("applyPageSubtitleState", expect.anything(), 2)
    await set(true)
    expect((await read(2)).enabled).toBe(true)
  })
})
