// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { SUBTITLE_POSITIONS, subtitlePresetPatch } from "@/utils/subtitles/appearance"
import { FeaturesSection } from ".."

beforeEach(() => fakeBrowser.reset())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderFeatures(style: Partial<Config["features"]["subtitleStyle"]> = {}) {
  const config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { ...DEFAULT_CONFIG.features.subtitleStyle, ...style } } }
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  const view = render(<Provider store={store}><FeaturesSection /></Provider>)
  return { ...view, store }
}

function openCustom() {
  const summary = screen.getByText("subtitleStyle.custom")
  fireEvent.click(summary)
  expect(summary.closest("details")).toHaveAttribute("open")
  return summary.closest("details")!
}

const presets = () => within(screen.getByRole("group", { name: "subtitleStyle.preset" }))
const savedStyle = (store: ReturnType<typeof createStore>) => store.get(configAtom).features.subtitleStyle

describe("subtitle settings", () => {
  it("places the original ratio below size inside Custom and restores the chosen preset before preserving display modes", async () => {
    const { container, store } = await renderFeatures()
    const slider = screen.getByRole("slider", { name: "subtitleStyle.originalFontScale" })
    expect(slider).not.toBeVisible()
    const custom = openCustom()
    const ratioRow = container.querySelector(".subtitle-original-size-row")!
    expect(ratioRow.previousElementSibling).toHaveClass("subtitle-font-row")
    expect(custom).toContainElement(ratioRow as HTMLElement)
    fireEvent.change(slider, { target: { value: "85" } })
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.originalFontScale).toBe(85))
    expect(container.querySelector<HTMLElement>(".subtitle-preview-caption")!.style.getPropertyValue("--readomi-original-font-scale")).toBe("0.85em")
    expect(container.querySelector(".subtitle-adjusted-label")).toHaveAttribute("aria-hidden", "false")
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.ink" }))
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ originalFontScale: 100, preset: "ink" }))
    const current = store.get(configAtom)
    act(() => store.set(configAtom, { ...current, features: { ...current.features, subtitleMode: "translationOnly" } }))
    expect(slider).toBeDisabled()
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.originalFontScaleValue" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "1:1" })).toBeDisabled()
    act(() => store.set(configAtom, current))
    expect(slider).toBeEnabled()
    expect(slider).toHaveValue("100")
    fireEvent.click(screen.getByRole("button", { name: "1:1" }))
    await waitFor(() => expect(savedStyle(store).originalFontScale).toBe(100))
  })

  it("keeps invalid numeric drafts out of storage and recovers with a valid value", async () => {
    const { store } = await renderFeatures({ originalFontScale: 100 })
    openCustom()
    const input = screen.getByRole("spinbutton", { name: "subtitleStyle.originalFontScaleValue" })
    for (const value of ["175", "45", "86", ""]) {
      fireEvent.change(input, { target: { value } })
      fireEvent.blur(input)
      expect(input).toHaveAttribute("aria-invalid", "true")
      expect(screen.getByRole("alert")).toHaveTextContent("subtitleStyle.originalFontScaleInvalid")
      expect(savedStyle(store).originalFontScale).toBe(100)
      expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.originalFontScale).toBe(100)
    }
    fireEvent.keyDown(input, { key: "Escape" })
    expect(input).toHaveValue(100)
    expect(input).not.toHaveAttribute("aria-invalid")
    fireEvent.change(input, { target: { value: "125" } })
    fireEvent.blur(input)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.originalFontScale).toBe(125))
  })

  it("retains a failed ratio in the preview while storage rolls back, then retries saving", async () => {
    const { container, store } = await renderFeatures({ originalFontScale: 100 })
    openCustom()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("Storage unavailable"))
    fireEvent.click(screen.getByRole("button", { name: "85%" }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("subtitleStyle.originalFontScaleSaveFailed"))
    expect(savedStyle(store).originalFontScale).toBe(100)
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.originalFontScale).toBe(100)
    expect(screen.getByRole("slider", { name: "subtitleStyle.originalFontScale" })).toHaveValue("85")
    expect(container.querySelector<HTMLElement>(".subtitle-preview-caption")!.style.getPropertyValue("--readomi-original-font-scale")).toBe("0.85em")
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.originalFontScaleRetry" }))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.originalFontScale).toBe(85)
  })

  it("does not replace a newer ratio with an older delayed save failure", async () => {
    const { container } = await renderFeatures()
    openCustom()
    vi.spyOn(console, "error").mockImplementation(() => {})
    let fail!: (error: Error) => void
    const pending = new Promise<never>((_, reject) => fail = reject)
    const writes = vi.spyOn(storage, "setItem").mockImplementationOnce(() => pending)
    fireEvent.click(screen.getByRole("button", { name: "85%" }))
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    fireEvent.click(within(screen.getByRole("group", { name: "subtitleStyle.originalFontScalePresets" })).getByRole("button", { name: "125%" }))
    await act(async () => fail(new Error("Older write failed")))
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.originalFontScale).toBe(125))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("slider", { name: "subtitleStyle.originalFontScale" })).toHaveValue("125")
    expect(container.querySelector<HTMLElement>(".subtitle-preview-caption")!.style.getPropertyValue("--readomi-original-font-scale")).toBe("1.25em")
  })
  it("persists control visibility independently of subtitle translation and appearance", async () => {
    const { store } = await renderFeatures()
    const toggle = screen.getByRole("switch", { name: "features.videoControls" })
    expect(toggle).toHaveAttribute("aria-checked", "true")
    const changeVisibility = async (videoControls: boolean) => {
      fireEvent.click(toggle)
      await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", String(videoControls)))
      await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features).toEqual({ ...DEFAULT_CONFIG.features, videoControls }))
      expect(store.get(configAtom).providersConfig).toEqual(DEFAULT_CONFIG.providersConfig)
    }
    await changeVisibility(false)
    await changeVisibility(true)
  })
  it("keeps one relative size control collapsed until requested", async () => {
    const { container, store } = await renderFeatures()
    const custom = container.querySelector<HTMLDetailsElement>(".subtitle-custom")!
    const more = container.querySelector<HTMLDetailsElement>(".subtitle-site-more")!
    expect(custom.open).toBe(false)
    expect(more.open).toBe(false)
    expect(screen.getByRole("switch", { name: "features.videoDefault" })).toBeVisible()
    expect(screen.queryByRole("group", { name: "subtitleStyle.fontSizeMode" })).toBeNull()
    expect(presets().getAllByRole("button")).toHaveLength(3)
    expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).not.toBeVisible()
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).not.toBeVisible()
    expect(screen.getByRole("group", { name: "subtitleStyle.position" })).not.toBeVisible()
    expect(screen.queryByRole("switch", { name: "subtitleStyle.background" })).toBeNull()

    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.ink" }))
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ ...subtitlePresetPatch("ink") }))
    expect(custom.open).toBe(false)
    openCustom()
    expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).toBeVisible()
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })).toHaveValue(100)
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).toBeVisible()
    expect(screen.getByRole("group", { name: "subtitleStyle.position" })).toBeVisible()
    expect(within(custom).queryByRole("group", { name: "subtitleStyle.fontSizeMode" })).toBeNull()
    expect(more.open).toBe(false)
  })

  it("shows common percentages, preserves precise size inputs and resets only position", async () => {
    const { store } = await renderFeatures({ relativeFontSize: 5.9375, position: { x: 60, y: 65 } })
    openCustom()
    const input = screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })
    expect(input).toHaveValue(169.64)
    const common = within(screen.getByRole("group", { name: "subtitleStyle.commonSizes" }))
    expect(common.getAllByRole("button").map(button => button.textContent)).toEqual(["80%", "100%", "125%", "150%"])
    fireEvent.click(common.getByRole("button", { name: "125%" }))
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(4.375))
    fireEvent.change(input, { target: { value: "169.64285714285714" } })
    fireEvent.blur(input)
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(5.9375))
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.resetPosition" }))
    await waitFor(() => expect(savedStyle(store).position).toEqual(SUBTITLE_POSITIONS.bottom))
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.relativeFontSize).toBe(5.9375)
  })

  it("rounds size labels without changing the saved size or precise adjustment steps", async () => {
    const { container, store } = await renderFeatures({ relativeFontSize: 2.75 })
    openCustom()
    const input = screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })
    const slider = screen.getByRole("slider", { name: "subtitleStyle.fontSize" })
    expect(input).toHaveValue(78.57)
    expect(slider).toHaveAttribute("aria-valuetext", "78.57 %")
    expect(container.querySelector(".subtitle-custom-values")).toHaveTextContent("78.57%")
    expect(container.querySelector(".subtitle-preview-summary")).toHaveTextContent("78.57%")
    fireEvent.blur(input)
    expect(savedStyle(store).relativeFontSize).toBe(2.75)
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.relativeFontSize).toBe(2.75)
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.larger" }))
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(2.925))
    expect(input).toHaveValue(83.57)
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.smaller" }))
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(2.75))
    expect(input).toHaveValue(78.57)
  })

  it("adjusts subtitle size by five percentage points and aligns range stops with common sizes", async () => {
    const { store } = await renderFeatures()
    openCustom()
    const input = screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })
    const slider = screen.getByRole("slider", { name: "subtitleStyle.fontSize" })
    expect(slider).toHaveAttribute("step", "5")
    expect(slider).toHaveAttribute("min", "40")
    expect(slider).toHaveAttribute("max", "710")
    expect(input).toHaveAttribute("min", "35.714285714285715")
    expect(input).toHaveAttribute("max", "714.2857142857143")
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.larger" }))
    await waitFor(() => expect(input).toHaveValue(105))
    expect(savedStyle(store).relativeFontSize).toBe(3.675)
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.larger" }))
    await waitFor(() => expect(input).toHaveValue(110))
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.smaller" }))
    await waitFor(() => expect(input).toHaveValue(105))
    for (const value of [80, 100, 125, 150]) {
      fireEvent.change(slider, { target: { value: String(value) } })
      await waitFor(() => expect(input).toHaveValue(value))
      expect((value - Number(slider.getAttribute("min"))) % Number(slider.getAttribute("step"))).toBe(0)
    }
  })

  it("preserves disabled legacy backgrounds until a depth edit and matches player padding", async () => {
    const { store } = await renderFeatures({ backgroundEnabled: false, backgroundOpacity: 72 })
    const custom = openCustom()
    const slider = screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })
    const caption = screen.getByRole("group", { name: "subtitleStyle.previewDragLabel" })
    expect(caption.style.padding).toBe("0px")
    const number = screen.getByRole("spinbutton", { name: "subtitleStyle.backgroundOpacity" })
    expect(slider).toHaveValue("0")
    expect(number).toHaveValue(0)
    expect(savedStyle(store)).toMatchObject({ backgroundEnabled: false, backgroundOpacity: 72 })
    fireEvent.change(number, { target: { value: "35" } })
    fireEvent.blur(number)
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ backgroundEnabled: true, backgroundOpacity: 35 }))
    expect(caption.style.padding).toBe("10px 16px")
    fireEvent.change(slider, { target: { value: "0" } })
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ backgroundEnabled: false, backgroundOpacity: 0 }))
    expect(caption.style.padding).toBe("0px")
    expect(slider).toBeVisible()
    expect(custom.open).toBe(true)
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.ink" }))
    expect(slider).toBeVisible()
    expect(caption.style.padding).toBe("0.6em 0.9em")
    expect(custom.open).toBe(true)
  })

  it("keeps the same control rows and modified-label node when switching presets", async () => {
    const { container, store } = await renderFeatures({ position: { x: 60, y: 65 } })
    openCustom()
    const rowCount = container.querySelectorAll(".subtitle-settings-group .settings-row").length
    const modified = container.querySelector(".subtitle-adjusted-label")!
    expect(modified).toHaveAttribute("aria-hidden", "true")
    fireEvent.change(screen.getByRole("slider", { name: "subtitleStyle.fontSize" }), { target: { value: "150" } })
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(5.25))
    expect(modified).toHaveAttribute("aria-hidden", "false")
    for (const preset of ["gold", "ink", "clear"] as const) {
      fireEvent.click(presets().getByRole("button", { name: `subtitleStyle.presets.${preset}` }))
      await waitFor(() => expect(savedStyle(store)).toMatchObject({ ...subtitlePresetPatch(preset), position: { x: 60, y: 65 } }))
      expect(container.querySelectorAll(".subtitle-settings-group .settings-row")).toHaveLength(rowCount)
      expect(container.querySelector(".subtitle-adjusted-label")).toBe(modified)
      expect(modified).toHaveAttribute("aria-hidden", "true")
    }
  })

  it("preserves the video aspect ratio when oversized captions overflow and recovers without changing configuration", async () => {
    let width = 320
    let captionHeight = 344
    let resizePreview = () => {}
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizePreview = callback }
      observe() {}
      disconnect() {}
    })
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("subtitle-preview-frame") || this.classList.contains("subtitle-preview-scene"))
        return new DOMRect(0, 0, width, width * 9 / 16)
      if (this.classList.contains("subtitle-preview-caption"))
        return new DOMRect(0, 0, width * 0.8, captionHeight)
      return originalRect.call(this)
    })
    const { store } = await renderFeatures({ relativeFontSize: 25 })
    const caption = screen.getByRole("group", { name: "subtitleStyle.previewDragLabel" })
    const scene = caption.parentElement!
    const frame = scene.parentElement!
    expect(frame.style.minHeight).toBe("")
    expect(scene.style.width).toBe("1280px")
    expect(scene.style.height).toBe("720px")
    expect(scene.style.transform).toBe("scale(0.25)")
    expect(caption.style.fontSize).toBe("180px")
    expect(screen.getByText("subtitleStyle.previewOverflow")).toHaveAttribute("role", "status")
    const saved = store.get(configAtom)
    width = 240
    act(() => resizePreview())
    expect(scene.style.transform).toBe("scale(0.1875)")
    expect(frame.style.minHeight).toBe("")
    expect(caption.style.fontSize).toBe("180px")
    expect(store.get(configAtom)).toEqual(saved)
    captionHeight = 40
    openCustom()
    fireEvent.click(screen.getByRole("button", { name: "100%" }))
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(3.5))
    expect(caption.style.fontSize).toBe("25.2px")
    expect(screen.getByText("subtitleStyle.previewOverflow")).not.toBeVisible()
    expect(frame.style.minHeight).toBe("")
  })

  it("switches short and long samples locally without changing appearance or saved settings", async () => {
    const { store } = await renderFeatures({ relativeFontSize: 7.5, originalFontScale: 125, backgroundEnabled: true, backgroundOpacity: 65, position: { x: 60, y: 65 } })
    const saved = store.get(configAtom)
    const samples = within(screen.getByRole("group", { name: "subtitleStyle.previewSample" }))
    const caption = screen.getByRole("group", { name: "subtitleStyle.previewDragLabel" })
    expect(samples.getByRole("button", { name: "subtitleStyle.previewSamples.short" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("subtitleStyle.previewOriginal")).toBeInTheDocument()
    fireEvent.click(samples.getByRole("button", { name: "subtitleStyle.previewSamples.long" }))
    expect(screen.queryByText("subtitleStyle.previewOriginal")).toBeNull()
    expect(screen.getByText("subtitleStyle.previewLongOriginal")).toBeInTheDocument()
    expect(caption.style.fontSize).toBe("54px")
    expect(caption.style.padding).toBe("10px 16px")
    expect(caption.style.borderRadius).toBe("8px")
    expect(caption.style.textShadow).toBe("0 2px 4px #0008")
    expect(caption.style.getPropertyValue("--readomi-original-font-scale")).toBe("1.25em")
    expect(store.get(configAtom)).toEqual(saved)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(saved)
    fireEvent.click(samples.getByRole("button", { name: "subtitleStyle.previewSamples.short" }))
    expect(screen.getByText("subtitleStyle.previewTranslation")).toBeInTheDocument()
  })

  it("saves keyboard preview moves without opening custom settings", async () => {
    const { container, store } = await renderFeatures()
    const custom = container.querySelector<HTMLDetailsElement>(".subtitle-custom")!
    const caption = screen.getByRole("group", { name: "subtitleStyle.previewDragLabel" })
    fireEvent.keyDown(caption, { key: "ArrowLeft" })
    await waitFor(() => expect(savedStyle(store).position.x).toBe(48))
    expect(custom.open).toBe(false)
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.position.x).toBe(48)
  })

  it("switches preview formats locally and keeps live styles, display mode and position editing", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("subtitle-preview-scene") || this.classList.contains("subtitle-preview-frame")) {
        const aspect = this.classList.contains("subtitle-preview-frame") ? this.dataset.aspect : this.parentElement!.dataset.aspect
        const width = aspect === "landscape" ? 640 : 285
        const height = width * (aspect === "portrait" ? 16 / 9 : aspect === "square" ? 1 : 9 / 16)
        return new DOMRect(0, 0, width, height)
      }
      if (this.classList.contains("subtitle-preview-caption"))
        return new DOMRect(0, 0, 180, 60)
      return originalRect.call(this)
    })
    const { container, store } = await renderFeatures()
    const initialConfig = store.get(configAtom)
    const formats = within(screen.getByRole("group", { name: "subtitleStyle.previewAspectRatio" }))
    const caption = screen.getByRole("group", { name: "subtitleStyle.previewDragLabel" })
    const frame = container.querySelector(".subtitle-preview-frame")!
    expect(caption.style.fontSize).toBe("25.2px")
    for (const aspect of ["portrait", "square", "landscape"] as const) {
      fireEvent.click(formats.getByRole("button", { name: `subtitleStyle.previewAspectRatios.${aspect}` }))
      expect(frame).toHaveAttribute("data-aspect", aspect)
      expect(formats.getByRole("button", { name: `subtitleStyle.previewAspectRatios.${aspect}` })).toHaveAttribute("aria-pressed", "true")
      expect(caption.style.fontSize).toBe("25.2px")
      expect(caption.parentElement!.style.transform).toBe(`scale(${aspect === "landscape" ? 0.5 : 285 / 720})`)
      expect(store.get(configAtom)).toEqual(initialConfig)
      expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(initialConfig)
    }
    fireEvent.click(formats.getByRole("button", { name: "subtitleStyle.previewAspectRatios.portrait" }))
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.ink" }))
    await waitFor(() => expect(savedStyle(store).preset).toBe("ink"))
    expect(caption.style.fontSize).toBe("25.2px")
    expect(caption.style.backgroundColor).toBe("rgba(16, 25, 27, 0.78)")
    fireEvent.click(formats.getByRole("button", { name: "subtitleStyle.previewAspectRatios.square" }))
    expect(caption.style.fontSize).toBe("25.2px")
    const current = store.get(configAtom)
    act(() => store.set(configAtom, { ...current, features: { ...current.features, subtitleMode: "translationOnly" } }))
    expect(screen.queryByText("subtitleStyle.previewOriginal")).toBeNull()
    expect(screen.getByText("subtitleStyle.previewTranslation")).toBeInTheDocument()
    fireEvent.keyDown(caption, { key: "ArrowLeft" })
    await waitFor(() => expect(savedStyle(store).position.x).toBe(48))
    expect(frame).toHaveAttribute("data-aspect", "square")
  })
})

describe("subtitle translation typography", () => {
  it("saves translation-only font and color edits, marks the preset modified and restores the full warm-gold preset", async () => {
    const { container, store } = await renderFeatures()
    expect(screen.getByRole("group", { name: "subtitleStyle.translationFont", hidden: true })).not.toBeVisible()
    openCustom()
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.gold" }))
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ preset: "gold", originalFontScale: 100, translationFont: "serif", translationColor: "#ffe0a0" }))
    const caption = container.querySelector<HTMLElement>(".subtitle-preview-caption")!
    expect(caption.style.getPropertyValue("--readomi-translation-font")).toContain("Songti SC")
    expect(caption.style.getPropertyValue("--readomi-translation-color")).toBe("#ffe0a0")
    const fonts = within(screen.getByRole("group", { name: "subtitleStyle.translationFont" }))
    expect(fonts.getByRole("button", { name: "subtitleStyle.translationFonts.serif" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(fonts.getByRole("button", { name: "subtitleStyle.translationFonts.sans" }))
    await waitFor(() => expect(savedStyle(store).translationFont).toBe("sans"))
    const color = screen.getByRole("textbox", { name: "subtitleStyle.translationColorValue" })
    fireEvent.change(color, { target: { value: "#AbCDef" } })
    fireEvent.keyDown(color, { key: "Enter" })
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle).toMatchObject({ translationFont: "sans", translationColor: "#abcdef", originalFontScale: 100 }))
    expect(caption.style.getPropertyValue("--readomi-translation-color")).toBe("#abcdef")
    expect(container.querySelector(".subtitle-adjusted-label")).toHaveAttribute("aria-hidden", "false")
    expect(presets().getByRole("button", { name: "subtitleStyle.presets.gold" })).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.gold" }))
    await waitFor(() => expect(savedStyle(store)).toMatchObject(subtitlePresetPatch("gold")))
    expect(color).toHaveValue("#FFE0A0")
    expect(container.querySelector(".subtitle-adjusted-label")).toHaveAttribute("aria-hidden", "true")
  })

  it("keeps invalid hex drafts out of storage and the preview, and recovers with Escape or another preset", async () => {
    const { container, store } = await renderFeatures()
    openCustom()
    const color = screen.getByRole("textbox", { name: "subtitleStyle.translationColorValue" })
    const saved = savedStyle(store)
    for (const value of ["#fff", "#gggggg", "red", ""]) {
      fireEvent.change(color, { target: { value } })
      fireEvent.blur(color)
      expect(color).toHaveAttribute("aria-invalid", "true")
      expect(screen.getByRole("alert")).toHaveTextContent("subtitleStyle.translationColorInvalid")
      expect(savedStyle(store)).toEqual(saved)
      expect(container.querySelector<HTMLElement>(".subtitle-preview-caption")!.style.getPropertyValue("--readomi-translation-color")).toBe("#ffffff")
    }
    fireEvent.keyDown(color, { key: "Escape" })
    expect(color).toHaveValue("#FFFFFF")
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.change(color, { target: { value: "#gggggg" } })
    fireEvent.blur(color)
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.gold" }))
    await waitFor(() => expect(color).toHaveValue("#FFE0A0"))
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(within(screen.getByRole("group", { name: "subtitleStyle.translationColor" })).getByRole("button", { name: "subtitleStyle.translationColors.mint" }))
    await waitFor(() => expect(savedStyle(store).translationColor).toBe("#bfe6df"))
  })
})
