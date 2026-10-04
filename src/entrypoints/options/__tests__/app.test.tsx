// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { LanguageProvider } from "@/components/providers/language-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { toast } from "@/components/toast"
import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_PRESET_STYLES, SUBTITLE_PRESETS } from "@/types/config/subtitle-style"
import { configAtom } from "@/utils/atoms/config"
import { storageAdapter } from "@/utils/atoms/storage-adapter"
import { clearClipboard, copyText } from "@/utils/clipboard"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { DEFAULT_TRANSLATE_PROMPT } from "@/utils/constants/prompt"
import { highlightedPrefixes, isWordPrefixHighlightRegistered, stubHighlightRegistry } from "@/utils/host/__tests__/highlight-registry-fake"
import { fetchProviderModels } from "@/utils/providers/models"
import { prepareRequest } from "@/utils/providers/request"
import { checkConnection } from "@/utils/providers/test-connection"
import { resolveSubtitleFontSize } from "@/utils/subtitles/appearance"
import { setUILanguage } from "@/utils/ui-language"
import App from "../app"

vi.mock("@/utils/providers/models", () => ({ fetchProviderModels: vi.fn() }))

vi.mock("@/utils/message", () => ({
  onMessage: vi.fn(() => vi.fn()),
  sendMessage: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock("@/components/ui/css-code-editor", () => ({
  CSSCodeEditor: () => <textarea aria-label="css-editor" readOnly />,
}))

vi.mock("@/utils/clipboard", async importOriginal => ({
  ...await importOriginal<typeof import("@/utils/clipboard")>(),
  clearClipboard: vi.fn(),
  copyText: vi.fn(),
}))

vi.mock("@/utils/providers/test-connection", async importOriginal => ({
  ...await importOriginal<typeof import("@/utils/providers/test-connection")>(),
  checkConnection: vi.fn(),
}))

const configured: Config = {
  ...DEFAULT_CONFIG,
  providersConfig: DEFAULT_CONFIG.providersConfig.map(provider => ({
    ...provider,
    apiKey: "sk-abcdefghijkl",
    connectionCheck: { ok: true, checkedAt: Date.now() - 2 * 60 * 60 * 1000 },
  })),
}

async function renderSettings(config: Config = DEFAULT_CONFIG, section = "service") {
  window.history.replaceState(null, "", `#${section}`)
  // The page writes through storage, so storage starts where the atom starts, as it does when the page loads.
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  const view = render(
    <Provider store={store}>
      <LanguageProvider>
        {() => (
          <ThemeProvider>
            <App />
          </ThemeProvider>
        )}
      </LanguageProvider>
    </Provider>,
  )
  return { ...view, store }
}

const editor = () => screen.getByLabelText("options.service.editorLabel") as HTMLTextAreaElement
const applyButton = () => screen.getByRole("button", { name: "options.service.apply" })

function selectValue(trigger: HTMLElement, value: string) {
  fireEvent.click(trigger)
  const option = screen.getAllByRole("option").find(option => option.getAttribute("data-value") === value)
  expect(option).toBeDefined()
  fireEvent.click(option!)
}

function chooseServiceMethod(method: "manual" | "agent") {
  if (!screen.queryByRole("button", { name: `manualService.${method}` }))
    fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
  fireEvent.click(screen.getByRole("button", { name: `manualService.${method}` }))
}

function openSubtitleMore() {
  const summary = screen.getByText("subtitleStyle.custom")
  const details = summary.closest("details")!
  if (!details.open)
    fireEvent.click(summary)
  expect(details).toHaveAttribute("open")
  return details
}

describe("settings page", () => {
  beforeEach(() => {
    setUILanguage("browser")
    fakeBrowser.reset()
    vi.mocked(checkConnection).mockResolvedValue({ ok: true, checkedAt: 1_000 })
    vi.mocked(clearClipboard).mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    setUILanguage("browser")
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("keeps size mode visible while custom adjustments open without changing saved settings", async () => {
    const { container, store } = await renderSettings(configured, "features")
    const details = container.querySelector<HTMLDetailsElement>(".subtitle-custom")!
    const summary = screen.getByText("subtitleStyle.custom")
    const saved = store.get(configAtom).features.subtitleStyle
    expect(details).not.toHaveAttribute("open")
    expect(summary.closest("summary")).toBeVisible()
    const mode = screen.getByRole("group", { name: "subtitleStyle.fontSizeMode" })
    expect(mode).toBeVisible()
    expect(details.contains(mode)).toBe(false)
    expect(within(screen.getByRole("group", { name: "subtitleStyle.preset" })).getAllByRole("button")).toHaveLength(4)
    expect(screen.queryByRole("switch", { name: "subtitleStyle.background" })).toBeNull()
    expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).not.toBeVisible()
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).not.toBeVisible()
    openSubtitleMore()
    expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).toBeVisible()
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).toHaveValue("0")
    expect(screen.getByRole("group", { name: "subtitleStyle.position" })).toBeVisible()
    expect(store.get(configAtom).features.subtitleStyle).toEqual(saved)
    fireEvent.click(summary)
    expect(details).not.toHaveAttribute("open")
    expect(mode).toBeVisible()
    expect(store.get(configAtom).features.subtitleStyle).toEqual(saved)
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle).toEqual(saved)
  })

  it("previews manual subtitle sizing and backgrounds, and resets only position", async () => {
    const position = { x: 60, y: 65 }
    const custom: Config = { ...configured, features: { ...configured.features, subtitleMode: "translationOnly", subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 30, relativeFontSize: 4.25, fontSizeMode: "fixed", position } } }
    const { store } = await renderSettings(custom, "features")
    const more = openSubtitleMore()
    const caption = screen.getByText("subtitleStyle.previewTranslation").parentElement!
    const presets = within(screen.getByRole("group", { name: "subtitleStyle.preset" }))
    expect(screen.queryByText("subtitleStyle.previewOriginal")).toBeNull()
    expect(more.querySelector("summary")).toHaveTextContent("subtitleStyle.positions.custom")
    expect(screen.getByText("subtitleStyle.modified")).toBeInTheDocument()
    expect(presets.getAllByRole("button").every(button => button.getAttribute("aria-pressed") === "false")).toBe(true)
    fireEvent.click(presets.getByRole("button", { name: "subtitleStyle.presets.compact" }))
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle).toEqual({ ...DEFAULT_SUBTITLE_STYLE, ...SUBTITLE_PRESET_STYLES.compact, preset: "compact", fontSizeMode: "fixed", position }))
    expect(presets.getByRole("button", { name: "subtitleStyle.presets.compact" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("subtitleStyle.modified")).toHaveAttribute("aria-hidden", "true")
    const fontSizeSlider = screen.getByRole("slider", { name: "subtitleStyle.fontSize" })
    const fontSizeInput = screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })
    expect(fontSizeSlider).toHaveAttribute("min", "8")
    expect(fontSizeSlider).toHaveAttribute("max", "80")
    expect(fontSizeSlider).toHaveAttribute("aria-valuetext", "16 px")
    fireEvent.change(fontSizeInput, { target: { value: "30" } })
    expect(store.get(configAtom).features.subtitleStyle.fontSize).toBe(16)
    expect(caption.style.fontSize).toBe("16px")
    fireEvent.blur(fontSizeInput)
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.fontSize).toBe(30))
    expect(caption.style.fontSize).toBe("30px")
    fireEvent.change(fontSizeInput, { target: { value: "" } })
    fireEvent.blur(fontSizeInput)
    expect(fontSizeInput).toHaveValue(30)
    expect(store.get(configAtom).features.subtitleStyle.fontSize).toBe(30)
    fireEvent.change(fontSizeInput, { target: { value: "3" } })
    fireEvent.blur(fontSizeInput)
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.fontSize).toBe(8))
    act(() => fontSizeInput.focus())
    fireEvent.change(fontSizeInput, { target: { value: "18.6" } })
    fireEvent.keyDown(fontSizeInput, { key: "Enter" })
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.fontSize).toBe(19))
    fireEvent.change(fontSizeSlider, { target: { value: "80" } })
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.fontSize).toBe(80))
    expect(screen.getByText("subtitleStyle.modified")).toBeInTheDocument()
    expect(presets.getByRole("button", { name: "subtitleStyle.presets.compact" })).toHaveAttribute("aria-pressed", "false")

    const depthSlider = screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })
    const depthInput = screen.getByRole("spinbutton", { name: "subtitleStyle.backgroundOpacity" })
    expect(depthSlider).toHaveAttribute("min", "0")
    expect(depthSlider).toHaveAttribute("max", "100")
    expect(depthSlider).toHaveAttribute("step", "1")
    fireEvent.change(depthInput, { target: { value: "72" } })
    expect(store.get(configAtom).features.subtitleStyle.backgroundOpacity).toBe(35)
    fireEvent.blur(depthInput)
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.backgroundOpacity).toBe(72))
    expect(caption.style.backgroundColor).toBe("rgba(15, 20, 35, 0.72)")
    const captionPadding = caption.style.padding
    fireEvent.change(depthSlider, { target: { value: "0" } })
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle).toMatchObject({ backgroundEnabled: false, backgroundOpacity: 0 }))
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).toBe(depthSlider)
    expect(depthInput).toHaveValue(0)
    expect(caption.style.backgroundColor).toBe("transparent")
    expect(caption.style.padding).toBe(captionPadding)
    fireEvent.change(depthInput, { target: { value: "72" } })
    fireEvent.blur(depthInput)
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.backgroundEnabled).toBe(true))
    expect(depthInput).toHaveValue(72)
    expect(caption.style.backgroundColor).toBe("rgba(15, 20, 35, 0.72)")
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle).toMatchObject({ fontSize: 80, relativeFontSize: 2.5, backgroundEnabled: true, backgroundOpacity: 72, position }))
    fireEvent.click(within(screen.getByRole("group", { name: "subtitleStyle.position" })).getByRole("button", { name: "subtitleStyle.positions.top" }))
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.position).toEqual({ x: 50, y: 18 }))
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.resetPosition" }))
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle).toMatchObject({ fontSize: 80, relativeFontSize: 2.5, backgroundEnabled: true, backgroundOpacity: 72, position: { x: 50, y: 88 } }))
    expect(store.get(configAtom).features.subtitleMode).toBe("translationOnly")
    expect(store.get(configAtom).translate.mode).toBe(custom.translate.mode)
  })

  it.each(["video", "fixed"] as const)("uses each %s preset in settings and preserves custom position and manually adjusted size across mode changes", async (fontSizeMode) => {
    const position = { x: 60, y: 65 }
    const custom: Config = { ...configured, features: { ...configured.features, subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, preset: "study", fontSize: 38, relativeFontSize: 5.5, backgroundEnabled: true, backgroundOpacity: 72, fontSizeMode, position } } }
    const { store } = await renderSettings(custom, "features")
    const caption = screen.getByText("subtitleStyle.previewTranslation").parentElement!
    const presetControl = within(screen.getByRole("group", { name: "subtitleStyle.preset" }))
    for (const preset of SUBTITLE_PRESETS) {
      fireEvent.click(presetControl.getByRole("button", { name: `subtitleStyle.presets.${preset}` }))
      const expectedStyle = { ...DEFAULT_SUBTITLE_STYLE, ...SUBTITLE_PRESET_STYLES[preset], preset, fontSizeMode, position }
      await waitFor(() => expect(store.get(configAtom).features.subtitleStyle).toEqual(expectedStyle))
      await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle).toEqual(expectedStyle))
      expect(screen.getByText("subtitleStyle.previewTranslation").parentElement).toBe(caption)
      expect(caption.style.fontSize).toBe(`${resolveSubtitleFontSize(expectedStyle)}px`)
      expect(caption.style.backgroundColor).toBe(expectedStyle.backgroundEnabled ? `rgba(15, 20, 35, ${expectedStyle.backgroundOpacity / 100})` : "transparent")
      expect(presetControl.getByRole("button", { name: `subtitleStyle.presets.${preset}` })).toHaveAttribute("aria-pressed", "true")
      expect(screen.getByText("subtitleStyle.modified")).toHaveAttribute("aria-hidden", "true")
    }
    openSubtitleMore()
    const manualSize = fontSizeMode === "video" ? 5.5 : 38
    fireEvent.change(screen.getByRole("slider", { name: "subtitleStyle.fontSize" }), { target: { value: String(manualSize) } })
    const manualStyle = { ...DEFAULT_SUBTITLE_STYLE, ...SUBTITLE_PRESET_STYLES.cinema, preset: "cinema" as const, fontSizeMode, position, ...(fontSizeMode === "video" ? { relativeFontSize: manualSize } : { fontSize: manualSize }) }
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle).toEqual(manualStyle))
    expect(screen.getByText("subtitleStyle.modified")).toBeInTheDocument()
    expect(presetControl.getAllByRole("button").every(button => button.getAttribute("aria-pressed") === "false")).toBe(true)
    const nextMode: "video" | "fixed" = fontSizeMode === "video" ? "fixed" : "video"
    openSubtitleMore()
    const modes = within(screen.getByRole("group", { name: "subtitleStyle.fontSizeMode" }))
    fireEvent.click(modes.getByRole("button", { name: `subtitleStyle.fontSizeModes.${nextMode}` }))
    const nextStyle = { ...manualStyle, fontSizeMode: nextMode }
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle).toEqual(nextStyle))
    expect(screen.getByText("subtitleStyle.previewTranslation").parentElement).toBe(caption)
    expect(caption.style.fontSize).toBe(`${resolveSubtitleFontSize(nextStyle)}px`)
    expect(presetControl.getByRole("button", { name: "subtitleStyle.presets.cinema" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("subtitleStyle.modified")).toHaveAttribute("aria-hidden", "true")
    fireEvent.click(modes.getByRole("button", { name: `subtitleStyle.fontSizeModes.${fontSizeMode}` }))
    await waitFor(() => expect(store.get(configAtom).features.subtitleStyle).toEqual(manualStyle))
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })).toHaveValue(manualSize)
    expect(screen.getByText("subtitleStyle.modified")).toBeInTheDocument()
  })

  it("saves the subtitle sizing mode and previews video-relative and fixed pixels at the actual card width", async () => {
    let width = 320
    let resizePreview = () => {}
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) {
        resizePreview = callback
      }

      observe() {}
      disconnect() {}
    })
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("subtitle-preview-scene") ? new DOMRect(0, 0, width, width * 9 / 16) : originalRect.call(this)
    })
    try {
      const { store } = await renderSettings(configured, "features")
      openSubtitleMore()
      const caption = screen.getByText("subtitleStyle.previewTranslation").parentElement!
      const modes = within(screen.getByRole("group", { name: "subtitleStyle.fontSizeMode" }))
      expect(modes.getByRole("button", { name: "subtitleStyle.fontSizeModes.video" })).toHaveAttribute("aria-pressed", "true")
      expect(screen.getByText("subtitleStyle.relativeFontDescription")).toBeInTheDocument()
      expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).toHaveAttribute("min", "1.25")
      expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).toHaveAttribute("max", "12.5")
      expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).toHaveAttribute("step", "0.25")
      expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).toHaveAttribute("aria-valuetext", "3 %")
      expect(caption.style.fontSize).toBe("9.6px")
      width = 640
      act(() => resizePreview())
      expect(caption.style.fontSize).toBe("19.2px")
      fireEvent.change(screen.getByRole("slider", { name: "subtitleStyle.fontSize" }), { target: { value: "3.25" } })
      await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.relativeFontSize).toBe(3.25))
      expect(caption.style.fontSize).toBe("20.8px")
      const relativeInput = screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })
      fireEvent.change(relativeInput, { target: { value: "4.125" } })
      expect(store.get(configAtom).features.subtitleStyle.relativeFontSize).toBe(3.25)
      fireEvent.blur(relativeInput)
      await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.relativeFontSize).toBe(4.125))
      expect(caption.style.fontSize).toBe("26.4px")
      fireEvent.click(modes.getByRole("button", { name: "subtitleStyle.fontSizeModes.fixed" }))
      await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.fontSizeMode).toBe("fixed"))
      expect(screen.getByText("subtitleStyle.fixedFontDescription")).toBeInTheDocument()
      width = 320
      act(() => resizePreview())
      expect(caption.style.fontSize).toBe("20px")
      expect(store.get(configAtom).features.subtitleStyle.fontSize).toBe(20)
      expect(store.get(configAtom).features.subtitleStyle.position).toEqual(configured.features.subtitleStyle.position)
      fireEvent.click(modes.getByRole("button", { name: "subtitleStyle.fontSizeModes.video" }))
      await waitFor(() => expect(store.get(configAtom).features.subtitleStyle.fontSizeMode).toBe("video"))
      expect(caption.style.fontSize).toBe("13.2px")
      expect(screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })).toHaveValue(4.125)
      expect(store.get(configAtom).features.subtitleStyle.fontSize).toBe(20)
      await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle).toMatchObject({ fontSizeMode: "video", fontSize: 20, relativeFontSize: 4.125 }))
    }
    finally {
      measure.mockRestore()
    }
  })

  it("has translation settings and a separate appearance section", async () => {
    const { container } = await renderSettings(configured)

    expect([...container.querySelectorAll("section[id]")].map(section => section.id)).toEqual(["service", "reading", "features", "quality", "shortcut", "appearance", "backup", "site-rules"])
    const navigation = within(screen.getByRole("navigation", { name: "settingsNavigation.label" }))
    expect(navigation.queryAllByRole("group")).toHaveLength(0)
    expect(navigation.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["#service", "#reading", "#features", "#quality", "#shortcut", "#appearance", "#backup"])
    expect(screen.getByText("options.version 1.0.0")).toBeInTheDocument()
    expect(screen.queryByText(/options\.advanced/)).toBeNull()
    expect(screen.getByRole("link", { name: "options.service.title" })).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("heading", { name: "options.reading.title" })).toBeNull()
    fireEvent.click(screen.getByRole("link", { name: "options.shortcut.title" }))
    // The shortcut is named after the action it runs.
    expect(screen.getByLabelText("options.shortcut.togglePage")).toBeInTheDocument()
  })

  it("keeps site rules behind a reading entry and preserves a rule draft through Back and Forward", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    const scrollY = Object.getOwnPropertyDescriptor(window, "scrollY")!
    Object.defineProperty(window, "scrollY", { configurable: true, value: 428 })
    try {
      await renderSettings(configured, "reading")
      const navigation = within(screen.getByRole("navigation", { name: "settingsNavigation.label" }))
      expect(navigation.queryByRole("link", { name: "siteRules.title" })).toBeNull()
      expect(screen.getByRole("heading", { name: "options.reading.title" })).toBeInTheDocument()
      expect(screen.queryByRole("searchbox")).toBeNull()
      const entry = screen.getByRole("link", { name: "siteRules.title" })
      expect(entry).toHaveAttribute("href", "#reading/site-rules")
      fireEvent.click(entry)
      expect(window.location.hash).toBe("#reading/site-rules")
      expect(navigation.getByRole("link", { name: "options.reading.title" })).toHaveAttribute("aria-current", "page")
      expect(screen.queryByRole("heading", { name: "options.reading.title" })).toBeNull()
      expect(screen.getByRole("heading", { name: "siteRules.title" })).toBeInTheDocument()
      expect(screen.queryByRole("textbox", { name: "siteRules.editorLabel" })).toBeNull()
      fireEvent.click(screen.getByRole("tab", { name: "siteRules.custom" }))
      fireEvent.click(screen.getByRole("button", { name: "siteRules.add" }))
      const draft = "[{\"id\":\"unfinished\",\"matches\":\"example.com\"}]"
      fireEvent.change(screen.getByRole("textbox", { name: "siteRules.editorLabel" }), { target: { value: draft } })
      fireEvent.click(screen.getByRole("link", { name: "siteRules.backToReading" }))
      await waitFor(() => expect(screen.getByRole("heading", { name: "options.reading.title" })).toBeInTheDocument())
      expect(window.location.hash).toBe("#reading")
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 428 })
      expect(screen.queryByRole("textbox", { name: "siteRules.editorLabel" })).toBeNull()
      act(() => window.history.forward())
      await waitFor(() => expect(screen.getByRole("textbox", { name: "siteRules.editorLabel" })).toHaveValue(draft))
      expect(window.location.hash).toBe("#reading/site-rules")
      fireEvent.click(navigation.getByRole("link", { name: "options.service.title" }))
      fireEvent.click(navigation.getByRole("link", { name: "options.reading.title" }))
      fireEvent.click(screen.getByRole("link", { name: "siteRules.title" }))
      expect(screen.getByRole("textbox", { name: "siteRules.editorLabel" })).toHaveValue(draft)
    }
    finally {
      scrollTo.mockRestore()
      Object.defineProperty(window, "scrollY", scrollY)
    }
  })

  it.each(["site-rules", "reading/site-rules"])("opens the %s deep link and returns to reading without a parent entry", async (hash) => {
    await renderSettings(configured, hash)
    expect(window.location.hash).toBe("#reading/site-rules")
    expect(screen.getByRole("heading", { name: "siteRules.title" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "options.reading.title" })).toHaveAttribute("aria-current", "page")
    const back = screen.getByRole("link", { name: "siteRules.backToReading" })
    expect(back).toHaveAttribute("href", "#reading")
    fireEvent.click(back)
    expect(window.location.hash).toBe("#reading")
    expect(screen.getByRole("heading", { name: "options.reading.title" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "siteRules.title" })).toBeNull()
  })

  it("follows old rule hash changes and parent history navigation", async () => {
    await renderSettings(configured, "reading")
    act(() => {
      window.history.replaceState(null, "", "#site-rules")
      window.dispatchEvent(new HashChangeEvent("hashchange"))
    })
    expect(window.location.hash).toBe("#reading/site-rules")
    expect(screen.getByRole("heading", { name: "siteRules.title" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "options.reading.title" })).toHaveAttribute("aria-current", "page")
    act(() => {
      window.history.replaceState(null, "", "#reading")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(screen.getByRole("heading", { name: "options.reading.title" })).toBeInTheDocument()
    expect(screen.queryByRole("searchbox")).toBeNull()
  })

  it("leaves modified and non-left link clicks to the browser", async () => {
    await renderSettings(configured, "reading")
    const entry = screen.getByRole("link", { name: "siteRules.title" })
    const browserClick = (link: HTMLElement, modifier: MouseEventInit) => {
      let preventedByApp = false
      window.addEventListener("click", (event) => {
        preventedByApp = event.defaultPrevented
        // JSDOM otherwise schedules native navigation after the test has ended.
        event.preventDefault()
      }, { once: true })
      fireEvent.click(link, modifier)
      expect(preventedByApp).toBe(false)
    }
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      browserClick(entry, modifier)
      expect(window.location.hash).toBe("#reading")
    }
    browserClick(screen.getByRole("link", { name: "options.service.title" }), { metaKey: true })
    expect(window.location.hash).toBe("#reading")
    fireEvent.click(entry)
    browserClick(screen.getByRole("link", { name: "siteRules.backToReading" }), { metaKey: true })
    expect(window.location.hash).toBe("#reading/site-rules")
  })

  it("stores hover and additional shortcuts, rejects conflicts and supports clearing", async () => {
    const { store } = await renderSettings(configured, "shortcut")
    selectValue(screen.getByLabelText("translationShortcuts.hover"), "clickAndHold")
    await waitFor(() => expect(store.get(configAtom).features.hoverHotkey).toBe("clickAndHold"))
    const recorder = screen.getByRole("button", { name: "translationShortcuts.mode" })
    fireEvent.click(recorder)
    fireEvent.keyDown(document, { key: "e", altKey: true })
    expect(screen.getByRole("alert")).toHaveTextContent("translationShortcuts.conflict")
    expect(store.get(configAtom).features.modeShortcut).toBe("Alt+M")
    expect(recorder).toHaveTextContent("M")
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(recorder)
    fireEvent.keyDown(document, { key: "m", altKey: true })
    await waitFor(() => expect(store.get(configAtom).features.modeShortcut).toBe("Alt+M"))
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(recorder)
    fireEvent.keyDown(document, { key: "Delete" })
    await waitFor(() => expect(store.get(configAtom).features.modeShortcut).toBe(""))
  })

  it("switches interface language immediately, persists it, and keeps translation languages and service drafts", async () => {
    const { store } = await renderSettings(configured)
    fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
    fireEvent.change(editor(), { target: { value: "unfinished service configuration" } })
    fireEvent.click(screen.getByRole("link", { name: "options.appearance.title" }))
    const selector = screen.getByLabelText("uiLanguage.title")
    expect(selector).toHaveAttribute("data-value", "browser")
    fireEvent.click(selector)
    expect(screen.getAllByRole("option")).toHaveLength(10)
    fireEvent.keyDown(selector, { key: "Escape" })
    selectValue(selector, "zh-CN")
    await waitFor(() => expect(screen.getByLabelText("界面语言")).toHaveAttribute("data-value", "zh-CN"))
    expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("zh-CN")
    await waitFor(async () => expect((await storage.getItem<Config>("local:config"))?.ui.language).toBe("zh-CN"))
    expect(store.get(configAtom).language).toEqual(configured.language)
    expect(store.get(configAtom).providersConfig).toEqual(configured.providersConfig)
    fireEvent.click(screen.getByRole("link", { name: "翻译服务" }))
    expect(screen.getByLabelText("翻译服务配置")).toHaveValue("unfinished service configuration")
    fireEvent.click(screen.getByRole("link", { name: "外观" }))
    selectValue(screen.getByLabelText("界面语言"), "browser")
    await waitFor(() => expect(screen.getByLabelText("uiLanguage.title")).toHaveAttribute("data-value", "browser"))
  })

  it("restores the saved interface language and reports a failed save", async () => {
    const { store } = await renderSettings({ ...configured, ui: { language: "zh-CN" } }, "appearance")
    const notify = vi.spyOn(toast, "error").mockImplementation(() => 0)
    const write = vi.spyOn(storageAdapter, "set").mockRejectedValueOnce(new Error("Storage unavailable"))
    try {
      expect(screen.getByLabelText("界面语言")).toHaveAttribute("data-value", "zh-CN")
      selectValue(screen.getByLabelText("界面语言"), "ja")
      await waitFor(() => expect(notify).toHaveBeenCalledWith("无法保存界面语言，请重试。"))
      expect(screen.getByLabelText("界面语言")).toHaveAttribute("data-value", "zh-CN")
      expect(store.get(configAtom).ui.language).toBe("zh-CN")
      expect((await storage.getItem<Config>("local:config"))?.ui.language).toBe("zh-CN")
    }
    finally {
      notify.mockRestore()
      write.mockRestore()
    }
  })

  it("changes theme with mouse and keyboard, persists it, and keeps the configured service", async () => {
    const { store } = await renderSettings(configured, "appearance")
    const terra = screen.getByRole("radio", { name: "options.appearance.colors.terra" })
    const plum = screen.getByRole("radio", { name: "options.appearance.colors.plum" })
    expect(terra).toHaveAttribute("aria-checked", "true")
    fireEvent.click(plum)
    await waitFor(async () => expect((await storage.getItem<Config>("local:config"))?.appearance.colorTheme).toBe("plum"))
    expect(plum).toHaveAttribute("aria-checked", "true")
    expect(document.documentElement.dataset.readomiTheme).toBe("plum")
    expect(document.documentElement.style.getPropertyValue("--rf-primary")).toBe("#79546D")
    fireEvent.keyDown(plum, { key: "ArrowRight" })
    await waitFor(async () => expect((await storage.getItem<Config>("local:config"))?.appearance.colorTheme).toBe("amber"))
    expect(screen.getByRole("radio", { name: "options.appearance.colors.amber" })).toHaveFocus()
    expect(store.get(configAtom).providersConfig).toEqual(configured.providersConfig)
    const modes = within(screen.getByRole("group", { name: "appearanceMode.title" }))
    fireEvent.click(modes.getByRole("button", { name: "appearanceMode.dark" }))
    await waitFor(async () => expect((await storage.getItem<Config>("local:config"))?.appearance).toEqual({ colorTheme: "amber", mode: "dark" }))
    expect(document.documentElement).toHaveClass("dark")
    fireEvent.click(modes.getByRole("button", { name: "appearanceMode.system" }))
    await waitFor(async () => expect((await storage.getItem<Config>("local:config"))?.appearance.mode).toBe("system"))
  })

  it("previews reading changes and retains them across navigation", async () => {
    stubHighlightRegistry()
    const { store } = await renderSettings(configured, "reading")
    const translationPreview = within(document.getElementById("reading")!).getByText(/^Reading and experience train your model of the world\.$/).parentElement!
    fireEvent.click(screen.getByText("options.reading.moreOptions"))
    const englishPreview = screen.getByText(/Even if you forget what you read/)

    fireEvent.click(screen.getByRole("switch", { name: "features.hover" }))
    await waitFor(() => expect(store.get(configAtom).features.hoverTranslation).toBe(true))
    fireEvent.click(screen.getByRole("link", { name: "features.title" }))
    expect(screen.queryByRole("switch", { name: "features.hover" })).toBeNull()
    expect(screen.getByRole("switch", { name: "features.video" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("link", { name: "options.reading.title" }))
    expect(screen.getByRole("switch", { name: "features.hover" })).toBeChecked()

    // Translation only shows the translation alone, and the translation style, which applies to bilingual display only, goes away.
    expect(screen.getByRole("group", { name: "options.reading.style.title" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "options.reading.mode.translationOnly" }))
    await waitFor(() => expect(translationPreview).not.toHaveTextContent("Reading and experience"))
    expect(translationPreview).toHaveTextContent("阅读和经历训练的是你对世界的模型。")
    expect(screen.queryByRole("group", { name: "options.reading.style.title" })).toBeNull()

    // The emphasis switch changes the English preview the way it changes pages.
    expect(highlightedPrefixes(englishPreview)).toEqual([])
    fireEvent.click(screen.getByRole("switch", { name: "options.reading.wordPrefixEmphasis.title" }))
    await waitFor(() => expect(highlightedPrefixes(englishPreview).slice(0, 3)).toEqual(["Read", "an", "exper"]))
    expect(store.get(configAtom).reading.wordPrefixEmphasis).toBe(true)

    fireEvent.click(screen.getByRole("switch", { name: "options.reading.wordPrefixEmphasis.title" }))
    await waitFor(() => expect(isWordPrefixHighlightRegistered()).toBe(false))
  })

  it("saves hover streaming independently and preserves it while hover translation is disabled", async () => {
    const config: Config = { ...configured, features: { ...configured.features, hoverTranslation: true } }
    const { store } = await renderSettings(config, "reading")
    fireEvent.click(screen.getByText("options.reading.moreOptions"))
    let streaming = screen.getByRole("switch", { name: "features.hoverStream" })
    const hover = screen.getByRole("switch", { name: "features.hover" })

    expect(streaming).toBeChecked()
    expect(streaming).toBeEnabled()
    expect(screen.getByText("features.hoverStreamDescription")).toBeInTheDocument()
    fireEvent.click(streaming)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.hoverStream).toBe(false))
    expect(store.get(configAtom).features.hoverTranslation).toBe(true)

    fireEvent.click(hover)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.hoverTranslation).toBe(false))
    expect(screen.queryByRole("switch", { name: "features.hoverStream" })).toBeNull()
    expect(store.get(configAtom).features.hoverStream).toBe(false)

    fireEvent.click(hover)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.hoverTranslation).toBe(true))
    streaming = screen.getByRole("switch", { name: "features.hoverStream" })
    expect(streaming).toBeEnabled()
    expect(streaming).not.toBeChecked()
    fireEvent.click(streaming)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.hoverStream).toBe(true))
    expect(store.get(configAtom).translate).toEqual(config.translate)
    expect(store.get(configAtom).providersConfig).toEqual(config.providersConfig)
  })

  it("retains the default hover streaming preference while its control is hidden", async () => {
    const { store } = await renderSettings(configured, "reading")
    fireEvent.click(screen.getByText("options.reading.moreOptions"))
    expect(screen.queryByRole("switch", { name: "features.hoverStream" })).toBeNull()
    expect(store.get(configAtom).features.hoverStream).toBe(true)
  })

  it("shows an empty editor right away when no service is configured", async () => {
    await renderSettings()

    expect(screen.getByText("options.service.empty.title")).toBeInTheDocument()
    expect(editor().value).toBe("")
    expect(applyButton()).toBeDisabled()
    expect(screen.queryByRole("button", { name: "options.service.cancel" })).toBeNull()
  })

  it("shows only a preview of a configured service, with its last check and no editor", async () => {
    await renderSettings(configured)

    expect(screen.getByText("OpenAI")).toBeInTheDocument()
    expect(screen.getByText("gpt-6-luna")).toBeInTheDocument()
    expect(screen.getByTestId("service-status")).toHaveTextContent("options.service.status.ok")
    expect(screen.queryByLabelText("options.service.editorLabel")).toBeNull()
  })

  it("opens the editor in place on the current service, masked and selected", async () => {
    await renderSettings(configured)
    fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))

    expect(JSON.parse(editor().value)).toEqual({ type: "openai", apiKey: "sk-…ijkl", model: "gpt-6-luna" })
    expect(editor().selectionStart).toBe(0)
    expect(editor().selectionEnd).toBe(editor().value.length)
    expect(screen.getByText("options.service.unchanged")).toBeInTheDocument()
    expect(applyButton()).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "options.service.cancel" }))
    expect(screen.queryByLabelText("options.service.editorLabel")).toBeNull()
  })

  it("opens Agent Setup again after configuration and preserves a draft on repeated clicks", async () => {
    const { store } = await renderSettings(configured)
    expect(screen.queryByRole("button", { name: "manualService.agent" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
    const agent = screen.getByRole("button", { name: "manualService.agent" })
    const manual = screen.getByRole("button", { name: "manualService.manual" })
    expect(agent).toHaveAttribute("aria-pressed", "true")
    expect(manual).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(agent)
    expect(agent).toHaveAttribute("aria-pressed", "true")
    expect(manual).toHaveAttribute("aria-pressed", "false")
    expect(JSON.parse(editor().value)).toEqual({ type: "openai", apiKey: "sk-…ijkl", model: "gpt-6-luna" })
    expect(editor()).toHaveFocus()
    expect(editor().selectionStart).toBe(0)
    expect(editor().selectionEnd).toBe(editor().value.length)
    expect(screen.getByRole("button", { name: "options.service.copyInstructions" })).toBeInTheDocument()
    expect(applyButton()).toBeDisabled()

    const draft = JSON.stringify({ type: "openai", apiKey: "sk-…ijkl", model: "draft-model" })
    fireEvent.change(editor(), { target: { value: draft } })
    fireEvent.click(agent)
    expect(editor()).toHaveValue(draft)

    fireEvent.click(screen.getByRole("button", { name: "options.service.cancel" }))
    expect(screen.queryByLabelText("options.service.editorLabel")).toBeNull()
    expect(screen.queryByRole("button", { name: "manualService.agent" })).toBeNull()
    chooseServiceMethod("agent")
    expect(JSON.parse(editor().value).model).toBe("gpt-6-luna")
    expect(store.get(configAtom)).toEqual(configured)
    expect(await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)).toEqual(configured)
    expect(checkConnection).not.toHaveBeenCalled()
  })

  it("previews what applying would change and reports invalid text", async () => {
    await renderSettings()

    fireEvent.change(editor(), { target: { value: "not json" } })
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument()
    expect(applyButton()).toBeDisabled()

    fireEvent.change(editor(), { target: { value: JSON.stringify({ type: "deepseek", apiKey: "sk-test", model: "deepseek-flash", body: { thinking: { type: "disabled" } } }) } })
    expect(screen.getByText("DeepSeek")).toBeInTheDocument()
    expect(screen.getByText("deepseek-flash")).toBeInTheDocument()
    expect(screen.getByText(/options\.service\.newKey/)).toBeInTheDocument()
    expect(screen.getByText(/options\.service\.thinkingOff/)).toBeInTheDocument()
    expect(applyButton()).toBeEnabled()
  })

  it("checks and saves the first agent configuration, then lets Agent Setup reopen it", async () => {
    const { store } = await renderSettings()
    fireEvent.change(editor(), { target: { value: JSON.stringify({ type: "deepseek", apiKey: "sk-test", model: "deepseek-flash" }) } })

    await act(async () => {
      fireEvent.click(applyButton())
    })

    await waitFor(() => expect(screen.queryByLabelText("options.service.editorLabel")).toBeNull())
    const saved = store.get(configAtom)
    const service = saved.providersConfig.find(p => p.id === saved.translate.providerId)
    expect(service).toMatchObject({ provider: "deepseek", apiKey: "sk-test", connectionCheck: { ok: true, checkedAt: 1_000 } })
    expect(vi.mocked(checkConnection).mock.calls[0][0]).toMatchObject({ provider: "deepseek", apiKey: "sk-test" })

    chooseServiceMethod("agent")
    expect(JSON.parse(editor().value)).toEqual({ type: "deepseek", apiKey: "sk-…test", model: "deepseek-flash" })
    expect(applyButton()).toBeDisabled()
    expect(screen.getByRole("button", { name: "options.service.copyInstructions" })).toBeInTheDocument()
    expect(store.get(configAtom)).toEqual(saved)
    expect(checkConnection).toHaveBeenCalledTimes(1)
  })

  it("keeps the editor open when it is opened again before the first setup finishes", async () => {
    let finishClearing!: () => void
    vi.mocked(clearClipboard).mockReturnValue(new Promise<void>((resolve) => {
      finishClearing = resolve
    }))
    await renderSettings()
    fireEvent.change(editor(), { target: { value: JSON.stringify({ type: "deepseek", apiKey: "sk-test", model: "deepseek-flash" }) } })

    await act(async () => {
      fireEvent.click(applyButton())
    })
    // Saved: the preview is shown while the clipboard is still being cleared.
    fireEvent.click(await screen.findByRole("button", { name: "options.service.edit" }))
    await act(async () => {
      finishClearing()
    })

    expect(editor()).toBeInTheDocument()
  })

  it("keeps the current service and stays in the editor when the check fails", async () => {
    vi.mocked(checkConnection).mockResolvedValue({ ok: false, checkedAt: 1_000, error: "401 invalid key" })
    const { store } = await renderSettings(configured)
    fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
    fireEvent.change(editor(), { target: { value: JSON.stringify({ type: "deepseek", apiKey: "sk-bad", model: "deepseek-flash" }) } })

    await act(async () => {
      fireEvent.click(applyButton())
    })

    expect(await screen.findByText("options.service.failedNotSaved")).toBeInTheDocument()
    expect(screen.getByText("401 invalid key")).toBeInTheDocument()
    expect(store.get(configAtom)).toEqual(configured)
    expect(editor()).toBeInTheDocument()
  })

  it("stores the result of a separate connection test", async () => {
    vi.mocked(checkConnection).mockResolvedValue({ ok: false, checkedAt: Date.now(), error: "timeout" })
    const { store } = await renderSettings(configured)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "options.service.test" }))
    })

    await waitFor(() => expect(screen.getByTestId("service-status")).toHaveTextContent("options.service.status.failed"))
    expect(store.get(configAtom).providersConfig[0].connectionCheck).toMatchObject({ ok: false, error: "timeout" })
  })

  it("edits the prompt in place and stores the built-in text as no custom prompt", async () => {
    const { store } = await renderSettings(configured, "quality")
    fireEvent.click(screen.getByRole("button", { name: "options.quality.prompt.edit" }))

    const template = screen.getByLabelText("options.quality.prompt.template") as HTMLTextAreaElement
    expect(template.value).toBe(DEFAULT_TRANSLATE_PROMPT)

    fireEvent.change(template, { target: { value: "Translate this" } })
    expect(screen.getByText("options.quality.prompt.missingInput")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "options.quality.prompt.apply" })).toBeDisabled()

    fireEvent.change(template, { target: { value: "Translate tersely: {{input}}" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "options.quality.prompt.apply" }))
    })
    expect(store.get(configAtom).translate.customPromptsConfig.patterns[0]).toMatchObject({ prompt: "Translate tersely: {{input}}" })
    expect(screen.getByText("options.quality.prompt.custom")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "options.quality.prompt.edit" }))
    fireEvent.click(screen.getByRole("button", { name: "options.quality.prompt.restore" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "options.quality.prompt.apply" }))
    })
    expect(store.get(configAtom).translate.customPromptsConfig).toEqual({ promptId: null, patterns: [] })
  })
})

describe("manual service configuration", () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.mocked(checkConnection).mockResolvedValue({ ok: true, checkedAt: 1_000 })
    vi.mocked(copyText).mockResolvedValue(true)
    vi.mocked(fetchProviderModels).mockResolvedValue(["model-a", "model-b"])
  })
  afterEach(() => {
    cleanup()
    setUILanguage("browser")
    vi.clearAllMocks()
  })
  it("keeps an unsaved form when switching sections and follows hash navigation", async () => {
    await renderSettings(configured)
    chooseServiceMethod("manual")
    fireEvent.change(screen.getByLabelText("manualService.model"), { target: { value: "draft-model" } })
    fireEvent.click(screen.getByRole("link", { name: "options.reading.title" }))
    expect(screen.queryByRole("button", { name: "manualService.save" })).toBeNull()
    fireEvent.click(screen.getByRole("link", { name: "options.service.title" }))
    expect(screen.getByLabelText("manualService.model")).toHaveValue("draft-model")
    act(() => {
      window.history.replaceState(null, "", "#shortcut")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(screen.getByRole("link", { name: "options.shortcut.title" })).toHaveAttribute("aria-current", "page")
  })
  it("fetches only on click, allows selecting and manually overriding a model without saving", async () => {
    const { store } = await renderSettings(configured)
    chooseServiceMethod("manual")
    expect(fetchProviderModels).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "modelDiscovery.fetch" }))
    const select = await screen.findByLabelText("modelDiscovery.select")
    expect(fetchProviderModels).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-abcdefghijkl", provider: "openai" }), expect.any(AbortSignal))
    selectValue(select, "model-b")
    expect(screen.getByLabelText("manualService.model")).toHaveValue("model-b")
    fireEvent.change(screen.getByLabelText("manualService.model"), { target: { value: "manual-model" } })
    expect(store.get(configAtom)).toEqual(configured)
  })
  it("never reuses a stored key at a different endpoint", async () => {
    await renderSettings({ ...configured, providersConfig: configured.providersConfig.map(p => ({ ...p, headers: { Authorization: "stored-auth" } })) })
    chooseServiceMethod("manual")
    fireEvent.change(screen.getByLabelText("manualService.url"), { target: { value: "https://other.example/v1" } })
    expect(screen.getByRole("button", { name: "modelDiscovery.fetch" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("manualService.key"), { target: { value: "new-key" } })
    fireEvent.click(screen.getByRole("button", { name: "modelDiscovery.fetch" }))
    await screen.findByLabelText("modelDiscovery.select")
    expect(fetchProviderModels).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://other.example/v1", apiKey: "new-key", headers: undefined }), expect.any(AbortSignal))
  })
  it("aborts and ignores a stale response when the address changes", async () => {
    let resolve!: (models: string[]) => void
    vi.mocked(fetchProviderModels).mockReturnValue(new Promise(r => resolve = r))
    await renderSettings(configured)
    chooseServiceMethod("manual")
    fireEvent.click(screen.getByRole("button", { name: "modelDiscovery.fetch" }))
    expect(screen.getByRole("button", { name: "modelDiscovery.loading" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("manualService.url"), { target: { value: "https://changed.example/v1" } })
    expect(vi.mocked(fetchProviderModels).mock.calls[0][1]?.aborted).toBe(true)
    await act(async () => resolve(["stale-model"]))
    expect(screen.queryByLabelText("modelDiscovery.select")).toBeNull()
    expect(screen.getByLabelText("manualService.model")).toHaveValue("gpt-6-luna")
  })
  it.each(["empty", "failed"])("keeps manual entry available when discovery is %s", async (state) => {
    if (state === "empty")
      vi.mocked(fetchProviderModels).mockResolvedValue([])
    else
      vi.mocked(fetchProviderModels).mockRejectedValue(new Error("no endpoint"))
    await renderSettings(configured)
    chooseServiceMethod("manual")
    fireEvent.click(screen.getByRole("button", { name: "modelDiscovery.fetch" }))
    await screen.findByText(`modelDiscovery.${state}`)
    expect(screen.getByLabelText("manualService.model")).toHaveValue("gpt-6-luna")
    expect(screen.getByRole("button", { name: "manualService.save" })).toBeEnabled()
  })
  it("opens Agent Setup after a manual model save and copies the latest masked configuration", async () => {
    const { store } = await renderSettings(configured)
    chooseServiceMethod("manual")
    expect(screen.getByLabelText("manualService.key")).toHaveValue("")
    fireEvent.change(screen.getByLabelText("manualService.model"), { target: { value: "my-local-model" } })
    fireEvent.click(screen.getByRole("button", { name: "manualService.save" }))
    await waitFor(() => expect(store.get(configAtom).providersConfig.find(p => p.id === store.get(configAtom).translate.providerId)?.model).toBe("my-local-model"))
    expect(store.get(configAtom).providersConfig[0].apiKey).toBe("sk-abcdefghijkl")
    await waitFor(() => expect(screen.queryByLabelText("manualService.model")).toBeNull())
    const saved = store.get(configAtom)

    chooseServiceMethod("agent")
    expect(JSON.parse(editor().value)).toMatchObject({ type: "openai", model: "my-local-model", apiKey: "sk-…ijkl" })
    expect(applyButton()).toBeDisabled()

    // Use the actual catalog so copied instructions include their substitutions.
    act(() => setUILanguage("zh-CN"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制给 agent 的说明" }))
    })
    const instructions = vi.mocked(copyText).mock.calls[0][0]
    expect(instructions).toContain("\"model\": \"my-local-model\"")
    expect(instructions).toContain("\"apiKey\": \"sk-…ijkl\"")
    expect(instructions).not.toContain("sk-abcdefghijkl")
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument()
    expect(store.get(configAtom)).toEqual(saved)
    expect(checkConnection).toHaveBeenCalledTimes(1)
  })
  it("finishes a pending manual save without closing the agent draft opened afterward", async () => {
    let finishCheck!: () => void
    vi.mocked(checkConnection).mockImplementation(() => new Promise((resolve) => {
      finishCheck = () => resolve({ ok: true, checkedAt: 1_000 })
    }))
    const { store } = await renderSettings(configured)
    chooseServiceMethod("manual")
    fireEvent.change(screen.getByLabelText("manualService.model"), { target: { value: "saved-manual-model" } })
    fireEvent.click(screen.getByRole("button", { name: "manualService.save" }))
    expect(checkConnection).toHaveBeenCalledTimes(1)

    chooseServiceMethod("agent")
    const agentEditor = editor()
    const draft = JSON.stringify({ type: "openai", apiKey: "sk-…ijkl", model: "new-agent-draft" })
    fireEvent.change(agentEditor, { target: { value: draft } })
    await act(async () => finishCheck())

    const saved = store.get(configAtom)
    expect(saved.providersConfig.find(p => p.id === saved.translate.providerId)?.model).toBe("saved-manual-model")
    expect(editor()).toBe(agentEditor)
    expect(editor()).toHaveValue(draft)
    expect(screen.getByRole("button", { name: "manualService.agent" })).toHaveAttribute("aria-pressed", "true")
    expect(applyButton()).toBeEnabled()
    expect(checkConnection).toHaveBeenCalledTimes(1)
  })
  it("shows existing parameters and uses edited nested JSON in the connection check and saved requests", async () => {
    const existing = { ...configured, providersConfig: configured.providersConfig.map(p => ({ ...p, body: { reasoning: { effort: "low" }, max_output_tokens: 1000 } })) }
    const { store } = await renderSettings(existing)
    chooseServiceMethod("manual")
    const input = screen.getByLabelText("manualService.body")
    expect(JSON.parse((input as HTMLTextAreaElement).value)).toEqual(existing.providersConfig[0].body)
    const body = { reasoning: { effort: "none", summary: "auto" }, max_output_tokens: 2000, metadata: { tags: ["translation", null], enabled: false } }
    fireEvent.change(input, { target: { value: JSON.stringify(body, null, 2) } })
    expect(store.get(configAtom)).toEqual(existing)
    fireEvent.click(screen.getByRole("button", { name: "manualService.save" }))
    await waitFor(() => expect(screen.queryByLabelText("manualService.body")).toBeNull())
    const saved = store.get(configAtom)
    const provider = saved.providersConfig.find(p => p.id === saved.translate.providerId)!
    expect(provider.body).toEqual(body)
    expect(checkConnection).toHaveBeenCalledWith(expect.objectContaining({ body }))
    expect(prepareRequest(provider, { prompt: "Translate this" }).body).toMatchObject({ ...body, input: "Translate this" })
    chooseServiceMethod("manual")
    expect(JSON.parse((screen.getByLabelText("manualService.body") as HTMLTextAreaElement).value)).toEqual(body)
  })
  it.each(["{", "[]", "null", "\"text\"", "42", "{\"budget\":1e999}"])("blocks invalid body %s before sending or saving", async (value) => {
    const { store } = await renderSettings(configured)
    chooseServiceMethod("manual")
    fireEvent.change(screen.getByLabelText("manualService.body"), { target: { value } })
    expect(screen.getByRole("alert")).toHaveTextContent("manualService.bodyInvalid")
    expect(screen.getByLabelText("manualService.body")).toHaveAttribute("aria-invalid", "true")
    const button = screen.getByRole("button", { name: "manualService.save" })
    expect(button).toBeDisabled()
    fireEvent.submit(button.closest("form")!)
    expect(checkConnection).not.toHaveBeenCalled()
    expect(store.get(configAtom)).toEqual(configured)
    fireEvent.change(screen.getByLabelText("manualService.body"), { target: { value: "{}" } })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(button).toBeEnabled()
  })
  it("clears saved parameters when the editor is emptied", async () => {
    const { store } = await renderSettings({ ...configured, providersConfig: configured.providersConfig.map(p => ({ ...p, body: { reasoning: { effort: "none" } } })) })
    chooseServiceMethod("manual")
    fireEvent.change(screen.getByLabelText("manualService.body"), { target: { value: "  " } })
    fireEvent.click(screen.getByRole("button", { name: "manualService.save" }))
    await waitFor(() => expect(screen.queryByLabelText("manualService.body")).toBeNull())
    expect(store.get(configAtom).providersConfig[0]).not.toHaveProperty("body")
    expect(vi.mocked(checkConnection).mock.calls[0][0]).not.toHaveProperty("body")
  })
  it("changes examples with the wire format without overwriting the parameter draft", async () => {
    await renderSettings(configured)
    chooseServiceMethod("manual")
    const input = screen.getByLabelText("manualService.body")
    expect(JSON.parse(input.getAttribute("placeholder")!)).toEqual({ reasoning: { effort: "none" } })
    fireEvent.change(input, { target: { value: "{\"custom\":true}" } })
    for (const [api, example] of [
      ["openai-chat", { reasoning_effort: "none" }],
      ["anthropic", { thinking: { type: "disabled" } }],
      ["gemini", { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } }],
    ] as const) {
      selectValue(screen.getByLabelText("manualService.api"), api)
      expect(JSON.parse(input.getAttribute("placeholder")!)).toEqual(example)
      expect(input).toHaveValue("{\"custom\":true}")
    }
    selectValue(screen.getByLabelText("manualService.type"), "deepseek")
    expect(input).toHaveValue("")
    expect(JSON.parse(input.getAttribute("placeholder")!)).toEqual({ thinking: { type: "disabled" } })
  })
  it("does not replace the working service when a manual connection check fails", async () => {
    vi.mocked(checkConnection).mockResolvedValue({ ok: false, checkedAt: 1_000, error: "HTTP 401" })
    const { store } = await renderSettings(configured)
    chooseServiceMethod("manual")
    fireEvent.change(screen.getByLabelText("manualService.model"), { target: { value: "bad-model" } })
    fireEvent.change(screen.getByLabelText("manualService.body"), { target: { value: "{\"reasoning\":{\"effort\":\"high\"}}" } })
    fireEvent.click(screen.getByRole("button", { name: "manualService.save" }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("HTTP 401"))
    expect(store.get(configAtom).providersConfig).toEqual(configured.providersConfig)
    expect(screen.getByLabelText("manualService.body")).toHaveValue("{\"reasoning\":{\"effort\":\"high\"}}")
  })
})

describe("configuration file import", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })
  it("previews before replacing all settings and clears obsolete provider fields", async () => {
    fakeBrowser.reset()
    const previous = { ...configured, providersConfig: configured.providersConfig.map(p => ({ ...p, temperature: 0.9 })) }
    const { store } = await renderSettings(previous, "backup")
    const next = { ...configured, features: { ...configured.features, hoverTranslation: true } }
    const file = new File(["backup"], "readomi-config.json", { type: "application/json" })
    Object.defineProperty(file, "text", { value: async () => JSON.stringify({ format: "readomi-config", config: next }) })
    fireEvent.change(screen.getByLabelText("configBackup.import"), { target: { files: [file] } })
    await screen.findByRole("button", { name: "configBackup.apply" })
    expect(store.get(configAtom).features.hoverTranslation).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "configBackup.apply" }))
    await screen.findByRole("status")
    expect(store.get(configAtom).features.hoverTranslation).toBe(true)
    expect(store.get(configAtom).providersConfig[0].temperature).toBeUndefined()
  })
  it("rejects an invalid file without changing any stored settings", async () => {
    fakeBrowser.reset()
    const { store } = await renderSettings(configured, "backup")
    const file = new File(["invalid"], "foreign.json")
    Object.defineProperty(file, "text", { value: async () => "{}" })
    fireEvent.change(screen.getByLabelText("configBackup.import"), { target: { files: [file] } })
    await screen.findByRole("alert")
    expect(store.get(configAtom)).toEqual(configured)
    expect(screen.queryByRole("button", { name: "configBackup.apply" })).toBeNull()
  })
})
