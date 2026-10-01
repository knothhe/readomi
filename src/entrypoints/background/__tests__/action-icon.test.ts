import type { Browser } from "wxt/browser"
import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { refreshActionIcons, updateActionIcon } from "../action-icon"
import { ensureInitializedConfig } from "../config"
import { getPageTranslationState } from "../page-translation-state"

vi.mock("../config", () => ({ ensureInitializedConfig: vi.fn() }))
vi.mock("../page-translation-state", async importOriginal => ({
  ...await importOriginal<typeof import("../page-translation-state")>(),
  getPageTranslationState: vi.fn(),
}))

describe("readomi toolbar colors", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(ensureInitializedConfig).mockResolvedValue(DEFAULT_CONFIG)
    vi.spyOn(browser.action, "setIcon").mockResolvedValue(undefined)
    vi.spyOn(browser.tabs, "query").mockImplementation(async () => ([
      { id: 1, url: "https://example.com/article" },
      { id: 2, url: "https://other.example/article" },
    ] as Browser.tabs.Tab[]))
    vi.mocked(getPageTranslationState).mockImplementation(async id => id === 1 ? { enabled: true, origin: "https://example.com" } : null)
  })

  it("recolors every tab override while preserving translated state, and sets the default for new tabs", async () => {
    const config: Config = { ...DEFAULT_CONFIG, appearance: { colorTheme: "plum" } }
    vi.mocked(ensureInitializedConfig).mockResolvedValue(config)
    await refreshActionIcons()
    expect(browser.action.setIcon).toHaveBeenCalledWith({ path: { 16: "/icon/plum/16.png", 32: "/icon/plum/32.png" } })
    expect(browser.action.setIcon).toHaveBeenCalledWith({ tabId: 1, path: { 16: "/icon/plum/translated-16.png", 32: "/icon/plum/translated-32.png" } })
    expect(browser.action.setIcon).toHaveBeenCalledWith({ tabId: 2, path: { 16: "/icon/plum/16.png", 32: "/icon/plum/32.png" } })
  })

  it("uses the stored color when translation starts or stops", async () => {
    vi.mocked(ensureInitializedConfig).mockResolvedValue({ ...DEFAULT_CONFIG, appearance: { colorTheme: "teal" } })
    await updateActionIcon(2, true)
    await updateActionIcon(2, false)
    expect(browser.action.setIcon).toHaveBeenNthCalledWith(1, { tabId: 2, path: { 16: "/icon/teal/translated-16.png", 32: "/icon/teal/translated-32.png" } })
    expect(browser.action.setIcon).toHaveBeenNthCalledWith(2, { tabId: 2, path: { 16: "/icon/teal/16.png", 32: "/icon/teal/32.png" } })
  })
})
