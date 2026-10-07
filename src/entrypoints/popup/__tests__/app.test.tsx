// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { configAtom } from "@/utils/atoms/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"
import { openOptionsPage } from "@/utils/navigation"
import App from "../app"
import { activeTabAtom, pageTranslationEnabledAtom, translationProgressAtom } from "../atoms"

vi.mock("@/utils/navigation", () => ({
  openOptionsPage: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/utils/message", () => ({
  onMessage: vi.fn(() => vi.fn()),
  sendMessage: vi.fn(() => Promise.resolve(undefined)),
}))

function renderPopup({ config = DEFAULT_CONFIG, enabled = false, translatable = true }: { config?: Config, enabled?: boolean, translatable?: boolean } = {}) {
  const store = createStore()
  store.set(configAtom, config)
  store.set(activeTabAtom, { id: 1, url: translatable ? "https://example.com/" : "chrome://newtab/", translatable })
  store.set(pageTranslationEnabledAtom, enabled)
  store.set(translationProgressAtom, enabled ? { total: 20, done: 5, failed: 0 } : null)

  return render(
    <Provider store={store}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </Provider>,
  )
}

const configWithKey: Config = {
  ...DEFAULT_CONFIG,
  providersConfig: DEFAULT_CONFIG.providersConfig.map(provider =>
    provider.id === DEFAULT_CONFIG.translate.providerId ? { ...provider, apiKey: "sk-test" } : provider,
  ),
}

describe("popup app", () => {
  afterEach(() => {
    cleanup()
  })

  it("follows appearance changes from settings without offering a popup appearance control", async () => {
    const config: Config = { ...configWithKey, appearance: { colorTheme: "teal", mode: "dark" } }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
    renderPopup({ config })
    expect(screen.queryByRole("group", { name: "appearanceMode.title" })).toBeNull()
    expect(document.documentElement).toHaveClass("dark")
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, { ...config, appearance: { ...config.appearance, mode: "light" } })
    await waitFor(() => expect(document.documentElement).toHaveClass("light"))
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.translate).toEqual(config.translate)
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"))
  })

  it("removes the video exclusion toggle and hides translation controls on a disabled website", async () => {
    const config: Config = { ...configWithKey, features: { ...configWithKey.features, disabledSites: ["example.com"] } }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
    renderPopup({ config })
    expect(screen.queryByRole("switch", { name: "popup.videoSiteExclusion.label" })).toBeNull()
    expect(screen.queryByRole("button", { name: "popup.translate" })).toBeNull()
    expect(screen.queryByRole("switch", { name: "features.video" })).toBeNull()
    const toggle = screen.getByRole("switch", { name: "popup.siteDisable.label" })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByRole("button", { name: "popup.translate" })).toBeEnabled())
    expect(screen.getByRole("switch", { name: "popup.siteDisable.label" })).not.toBeChecked()
  })

  it("points to the settings page instead of configuring anything while the service has no key", () => {
    renderPopup()

    expect(screen.getByText("popup.setup.title")).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button", { name: /popup\.translate$/ })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "popup.setup.openSettings" }))
    expect(openOptionsPage).toHaveBeenCalledWith({ section: "service" })
  })

  it("shows the translate action and keeps display mode controls in settings", () => {
    renderPopup({ config: configWithKey })

    expect(screen.getByRole("button", { name: /popup\.translate/ })).toBeEnabled()
    expect(screen.queryByRole("group", { name: "popup.displayMode" })).toBeNull()
    expect(screen.queryByRole("group", { name: "features.mode" })).toBeNull()
    expect(screen.queryByText("popup.setup.title")).toBeNull()
  })

  it("translates and restores the current tab using the button in the page row", () => {
    renderPopup({ config: configWithKey })
    const translate = screen.getByRole("button", { name: "popup.translate" })
    expect(translate).toHaveTextContent("popup.translateAction")

    fireEvent.click(translate)
    expect(sendMessage).toHaveBeenCalledWith("tryToSetEnablePageTranslationByTabId", { tabId: 1, enabled: true })

    fireEvent.click(screen.getByRole("button", { name: "popup.showOriginal" }))
    expect(sendMessage).toHaveBeenCalledWith("tryToSetEnablePageTranslationByTabId", { tabId: 1, enabled: false })
    expect(screen.getByRole("button", { name: "popup.translate" })).toBeEnabled()
  })

  it("offers to show the original and reports progress while translating", () => {
    renderPopup({ config: configWithKey, enabled: true })

    expect(screen.getByRole("button", { name: /popup\.showOriginal/ })).toBeInTheDocument()
    expect(screen.getByText("popup.translating")).toBeInTheDocument()
    expect(screen.getByText("5 / 20")).toBeInTheDocument()
  })

  it("disables translation on pages the content script cannot reach", () => {
    renderPopup({ config: configWithKey, translatable: false })

    expect(screen.getByRole("button", { name: /popup\.translate/ })).toBeDisabled()
    expect(screen.getByText("popup.notTranslatable")).toBeInTheDocument()
  })

  it("persists the hover toggle without changing the trigger or other features, even without a service", async () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      features: { ...DEFAULT_CONFIG.features, hoverHotkey: "backtick", videoSubtitles: true },
    }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
    renderPopup({ config })
    const toggle = screen.getByRole("switch", { name: "features.hover" })
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("button", { name: "translationShortcuts.hover" })).toHaveTextContent("translationShortcuts.backtick")

    fireEvent.click(toggle)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features).toEqual({
      ...config.features,
      hoverTranslation: true,
    }))
    expect(toggle).toHaveAttribute("aria-checked", "true")

    fireEvent.click(toggle)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features).toEqual(config.features))
    expect(toggle).toHaveAttribute("aria-checked", "false")

    fireEvent.click(screen.getByRole("button", { name: "translationShortcuts.hover" }))
    expect(openOptionsPage).toHaveBeenCalledWith({ section: "shortcut" })
  })

  it("keeps long model details in the service tooltip", () => {
    const provider = configWithKey.providersConfig.find(p => p.id === configWithKey.translate.providerId)!
    const model = "codex/a-very-long-model-name"
    renderPopup({ config: {
      ...configWithKey,
      providersConfig: configWithKey.providersConfig.map(p => p.id === provider.id ? { ...p, model } : p),
    } })

    expect(screen.queryByText(new RegExp(model))).toBeNull()
    expect(screen.getByTitle(`${provider.name} · ${model}`)).toHaveTextContent(provider.name)
  })

  it("keeps article context in settings and exposes quality and agent repair under help", () => {
    renderPopup({ config: configWithKey })
    expect(screen.queryByRole("switch", { name: "options.quality.context.title" })).toBeNull()
    const summary = screen.getByText("popup.recovery.help")
    expect(summary.closest("details")).not.toHaveAttribute("open")
    fireEvent.click(summary)
    fireEvent.click(screen.getByRole("button", { name: "popup.recovery.quality" }))
    expect(openOptionsPage).toHaveBeenCalledWith({ section: "quality" })
    expect(screen.getByRole("button", { name: /siteRuleAgent.entry/ })).toBeVisible()
  })

  it("switches page subtitles without changing the default, hover preference or subtitle mode", async () => {
    const config: Config = {
      ...configWithKey,
      features: { ...configWithKey.features, hoverTranslation: true, subtitleMode: "translationOnly", subtitlesShortcut: "Alt+V" },
    }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
    const state = { url: "https://example.com/", enabled: false, available: true, overridden: false }
    vi.mocked(sendMessage).mockImplementation(async (type, data) => {
      if (type === "getPageSubtitleState")
        return state
      if (type === "setPageSubtitleState")
        return { ...state, enabled: (data as { enabled: boolean }).enabled, overridden: true }
    })
    renderPopup({ config })
    const toggle = screen.getByRole("switch", { name: "features.video" })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(screen.queryByRole("group", { name: "features.mode" })).toBeNull()

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"))
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features).toEqual(config.features)

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"))
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features).toEqual(config.features)
    vi.mocked(sendMessage).mockImplementation(async () => undefined)

    expect(screen.queryByRole("button", { name: "subtitleStyle.adjust" })).toBeNull()
  })

  it("turns English word-prefix emphasis on and off from the footer, with or without a service", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
    renderPopup()
    const toggle = screen.getByRole("button", { name: "popup.wordPrefixEmphasis" })
    expect(toggle).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(toggle)

    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"))
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.reading.wordPrefixEmphasis).toBe(true))
  })

  it("catches up with progress that finished while it was opening", async () => {
    // The last report reached the background after the popup read it and before the popup listened.
    vi.mocked(sendMessage).mockImplementation(((type: string) => Promise.resolve(
      type === "getTranslationProgressByTabId" ? { total: 20, done: 20, failed: 0 } : type === "getEnablePageTranslationByTabId" ? true : undefined,
    )) as typeof sendMessage)
    // The popup keeps its config in step with storage, so storage holds the same config.
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, configWithKey)
    renderPopup({ config: configWithKey, enabled: true })

    await waitFor(() => expect(screen.getByText("popup.translated")).toBeInTheDocument())
    vi.mocked(sendMessage).mockImplementation((() => Promise.resolve(undefined)) as typeof sendMessage)
  })
})
