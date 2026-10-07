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
let url: string
let config: Config
const read = (tabId = 1) => handlers.get("getPageSubtitleState")!({ data: { tabId } })
const set = (enabled?: boolean, tabId = 1) => handlers.get("setPageSubtitleState")!({ data: { tabId, enabled } })

beforeEach(() => {
  fakeBrowser.reset()
  vi.clearAllMocks()
  handlers.clear()
  url = "https://www.youtube.com/watch?v=one"
  config = DEFAULT_CONFIG
  getConfig.mockImplementation(async () => config)
  vi.spyOn(browser.tabs, "get").mockImplementation(async id => ({ id, url }) as Browser.tabs.Tab)
  vi.spyOn(browser.webNavigation.onCommitted, "addListener")
  vi.spyOn(browser.webNavigation.onHistoryStateUpdated, "addListener")
  vi.spyOn(browser.tabs.onRemoved, "addListener")
  setupSubtitleState()
})

describe("shared page subtitle state", () => {
  it("enables a page from a disabled default, shares it with embedded frames and leaves another tab's default alone", async () => {
    expect((await read()).enabled).toBe(false)
    const state = await set(true)
    expect(state).toMatchObject({ enabled: true, available: true, overridden: true })
    expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", state, 1)
    expect(sendMessage).toHaveBeenCalledWith("pageSubtitleStateChanged", { tabId: 1, state })
    expect(await handlers.get("getPageSubtitleState")!({ sender: { tab: { id: 1 }, frameId: 3 } })).toEqual(state)
    expect((await read(2)).enabled).toBe(false)
    expect(config).toBe(DEFAULT_CONFIG)
  })
  it("serializes consecutive toggles against the actual value", async () => {
    const states = await Promise.all([set(), set(), set()])
    expect(states.map(state => state.enabled)).toEqual([true, false, true])
    expect((await read()).enabled).toBe(true)
  })
  it("targets the website when the extension popup is opened in its own tab", async () => {
    const state = await handlers.get("setPageSubtitleState")!({ data: { tabId: 1, enabled: true }, sender: { tab: { id: 99 }, url: browser.runtime.getURL("/popup.html") } })
    expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", state, 1)
    expect((await read(99)).enabled).toBe(false)
  })
  it("preserves the page choice across default and chapter changes and resets for another video", async () => {
    await set(false)
    config = { ...config, features: { ...config.features, videoSubtitles: true } }
    url += "&t=50&list=playlist#chapter"
    expect((await read()).enabled).toBe(false)
    url = "https://www.youtube.com/watch?v=two"
    expect(await read()).toMatchObject({ enabled: true, overridden: false })
  })
  it("clears choices on refresh and tab close", async () => {
    await set(true)
    await vi.mocked(browser.webNavigation.onCommitted.addListener).mock.calls.at(-1)![0]({ tabId: 1, frameId: 0, url } as Parameters<Parameters<typeof browser.webNavigation.onCommitted.addListener>[0]>[0])
    expect((await read()).enabled).toBe(false)
    await set(true)
    await vi.mocked(browser.tabs.onRemoved.addListener).mock.calls.at(-1)![0](1, { windowId: 1, isWindowClosing: false })
    expect(await storage.getItem("session:pageSubtitles:1")).toBeNull()
  })
  it.each([false, true])("restores the %s default in existing frames and the popup after top-level SPA navigation", async (defaultEnabled) => {
    config = { ...config, features: { ...config.features, videoSubtitles: defaultEnabled } }
    await set(!defaultEnabled)
    vi.mocked(sendMessage).mockClear()
    url = "https://www.youtube.com/watch?v=two"
    const navigate = vi.mocked(browser.webNavigation.onHistoryStateUpdated.addListener).mock.calls.at(-1)![0]
    await navigate({ tabId: 1, frameId: 0, url } as Parameters<typeof navigate>[0])
    const state = { url, enabled: defaultEnabled, available: true, overridden: false }
    expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", state, 1)
    expect(sendMessage).toHaveBeenCalledWith("pageSubtitleStateChanged", { tabId: 1, state })
    expect(await storage.getItem("session:pageSubtitles:1")).toBeNull()
  })
  it("preserves the page choice on chapter changes and ignores iframe history navigation", async () => {
    await set(true)
    vi.mocked(sendMessage).mockClear()
    const navigate = vi.mocked(browser.webNavigation.onHistoryStateUpdated.addListener).mock.calls.at(-1)![0]
    await navigate({ tabId: 1, frameId: 3, url: "https://embedded.example/two" } as Parameters<typeof navigate>[0])
    expect(sendMessage).not.toHaveBeenCalled()
    url += "&t=50&list=playlist#chapter"
    await navigate({ tabId: 1, frameId: 0, url } as Parameters<typeof navigate>[0])
    const state = { url, enabled: true, available: true, overridden: true }
    expect(sendMessage).toHaveBeenCalledWith("applyPageSubtitleState", state, 1)
    expect(await read()).toEqual(state)
  })
  it.each(["disabled", "excluded"])("clears %s page choices even while the content runtime is stopped", async (reason) => {
    await set(true)
    vi.spyOn(browser.tabs, "query").mockImplementation(async () => [{ id: 1, url }] as Browser.tabs.Tab[])
    const previous = config
    config = { ...config, features: { ...config.features, disabledSites: reason === "disabled" ? ["www.youtube.com"] : [], videoExcludedSites: reason === "excluded" ? [{ type: "domain", value: "youtube.com" }] : [] } }
    watchConfig.mock.calls.at(-1)![0](config, previous)
    await vi.waitFor(async () => expect(await storage.getItem("session:pageSubtitles:1")).toBeNull())
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("pageSubtitleStateChanged", { tabId: 1, state: expect.objectContaining({ enabled: false, available: false }) }))
    config = previous
    watchConfig.mock.calls.at(-1)![0](config, null)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("pageSubtitleStateChanged", { tabId: 1, state: expect.objectContaining({ enabled: false, available: true }) }))
    expect(await read()).toMatchObject({ enabled: false, overridden: false })
  })
  it.each(["disabled", "excluded", "restricted"])("does not allow a page choice to bypass %s pages", async (reason) => {
    await set(true)
    if (reason === "restricted")
      url = "chrome://extensions/"
    else
      config = { ...config, features: { ...config.features, disabledSites: reason === "disabled" ? ["www.youtube.com"] : [], videoExcludedSites: reason === "excluded" ? [{ type: "domain", value: "youtube.com" }] : [] } }
    expect(await read()).toMatchObject({ enabled: false, available: false })
    await expect(set(true)).rejects.toThrow("unavailable")
  })
  it("rejects a stale popup and rolls back when the host script cannot apply the switch", async () => {
    await expect(handlers.get("setPageSubtitleState")!({ data: { tabId: 1, url: "https://example.com/", enabled: true } })).rejects.toThrow("page changed")
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("No content script"))
    await expect(set(true)).rejects.toThrow("No content script")
    expect((await read()).enabled).toBe(false)
  })
})
