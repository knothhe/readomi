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
  it("places the original ratio below size inside Custom and preserves it through presets and display modes", async () => {
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
    expect(container.querySelector(".subtitle-adjusted-label")).toHaveAttribute("aria-hidden", "true")
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.compact" }))
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ originalFontScale: 85, preset: "compact" }))
    const current = store.get(configAtom)
    act(() => store.set(configAtom, { ...current, features: { ...current.features, subtitleMode: "translationOnly" } }))
    expect(slider).toBeDisabled()
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.originalFontScaleValue" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "1:1" })).toBeDisabled()
    act(() => store.set(configAtom, current))
    expect(slider).toBeEnabled()
    expect(slider).toHaveValue("85")
    fireEvent.click(screen.getByRole("button", { name: "1:1" }))
    await waitFor(() => expect(savedStyle(store).originalFontScale).toBe(100))
  })

  it("keeps invalid numeric drafts out of storage and recovers with a valid value", async () => {
    const { store } = await renderFeatures()
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
    const { container, store } = await renderFeatures()
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
    expect(presets().getAllByRole("button")).toHaveLength(4)
    expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).not.toBeVisible()
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).not.toBeVisible()
    expect(screen.getByRole("group", { name: "subtitleStyle.position" })).not.toBeVisible()
    expect(screen.queryByRole("switch", { name: "subtitleStyle.background" })).toBeNull()

    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.compact" }))
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ ...subtitlePresetPatch("compact") }))
    expect(custom.open).toBe(false)
    openCustom()
    expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).toBeVisible()
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })).toHaveValue(80)
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).toBeVisible()
    expect(screen.getByRole("group", { name: "subtitleStyle.position" })).toBeVisible()
    expect(within(custom).queryByRole("group", { name: "subtitleStyle.fontSizeMode" })).toBeNull()
    expect(more.open).toBe(false)
  })

  it("shows common percentages, preserves precise size inputs and resets only position", async () => {
    const { store } = await renderFeatures({ relativeFontSize: 5.9375, position: { x: 60, y: 65 } })
    openCustom()
    const input = screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })
    expect(input).toHaveValue(118.75)
    const common = within(screen.getByRole("group", { name: "subtitleStyle.commonSizes" }))
    expect(common.getAllByRole("button").map(button => button.textContent)).toEqual(["80%", "100%", "125%", "150%"])
    fireEvent.click(common.getByRole("button", { name: "125%" }))
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(6.25))
    fireEvent.change(input, { target: { value: "118.75" } })
    fireEvent.blur(input)
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(5.9375))
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.resetPosition" }))
    await waitFor(() => expect(savedStyle(store).position).toEqual(SUBTITLE_POSITIONS.bottom))
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle.relativeFontSize).toBe(5.9375)
  })

  it("preserves disabled legacy backgrounds until a depth edit and keeps preview padding stable", async () => {
    const { store } = await renderFeatures({ backgroundEnabled: false, backgroundOpacity: 72 })
    const custom = openCustom()
    const slider = screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })
    const caption = screen.getByRole("group", { name: "subtitleStyle.previewDragLabel" })
    const padding = caption.style.padding
    const number = screen.getByRole("spinbutton", { name: "subtitleStyle.backgroundOpacity" })
    expect(slider).toHaveValue("0")
    expect(number).toHaveValue(0)
    expect(savedStyle(store)).toMatchObject({ backgroundEnabled: false, backgroundOpacity: 72 })
    fireEvent.change(number, { target: { value: "35" } })
    fireEvent.blur(number)
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ backgroundEnabled: true, backgroundOpacity: 35 }))
    expect(caption.style.padding).toBe(padding)
    fireEvent.change(slider, { target: { value: "0" } })
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ backgroundEnabled: false, backgroundOpacity: 0 }))
    expect(caption.style.padding).toBe(padding)
    expect(slider).toBeVisible()
    expect(custom.open).toBe(true)
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.compact" }))
    expect(slider).toBeVisible()
    expect(caption.style.padding).toBe(padding)
    expect(custom.open).toBe(true)
  })

  it("keeps the same control rows and modified-label node when switching presets", async () => {
    const { container, store } = await renderFeatures({ position: { x: 60, y: 65 } })
    openCustom()
    const rowCount = container.querySelectorAll(".subtitle-settings-group .settings-row").length
    const modified = container.querySelector(".subtitle-adjusted-label")!
    expect(modified).toHaveAttribute("aria-hidden", "true")
    fireEvent.change(screen.getByRole("slider", { name: "subtitleStyle.fontSize" }), { target: { value: "105" } })
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(5.25))
    expect(modified).toHaveAttribute("aria-hidden", "false")
    for (const preset of ["compact", "study", "cinema", "clear"] as const) {
      fireEvent.click(presets().getByRole("button", { name: `subtitleStyle.presets.${preset}` }))
      await waitFor(() => expect(savedStyle(store)).toMatchObject({ ...subtitlePresetPatch(preset), position: { x: 60, y: 65 } }))
      expect(container.querySelectorAll(".subtitle-settings-group .settings-row")).toHaveLength(rowCount)
      expect(container.querySelector(".subtitle-adjusted-label")).toBe(modified)
      expect(modified).toHaveAttribute("aria-hidden", "true")
    }
  })

  it("fits a measured large caption without shrinking its font and only grows the frame when needed", async () => {
    let width = 320
    let captionHeight = 344
    let resizePreview = () => {}
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) {
        resizePreview = callback
      }

      observe() {}
      disconnect() {}
    })
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("subtitle-preview-scene")) {
        const height = Math.max(width * 9 / 16, Number.parseFloat(this.parentElement!.style.minHeight) || 0)
        return new DOMRect(0, 0, width, height)
      }
      if (this.classList.contains("subtitle-preview-caption"))
        return new DOMRect(0, 0, width - 16, captionHeight)
      return originalRect.call(this)
    })
    const { store } = await renderFeatures({ relativeFontSize: 25, backgroundEnabled: false, backgroundOpacity: 0 })
    const caption = screen.getByRole("group", { name: "subtitleStyle.previewDragLabel" })
    const scene = caption.parentElement!
    const frame = scene.parentElement!
    const expectCaptionFits = () => {
      const height = scene.getBoundingClientRect().height
      const bottom = Number.parseFloat(caption.style.top) / 100 * height
      expect(bottom - captionHeight).toBeGreaterThanOrEqual(12)
      expect(bottom).toBeLessThan(height)
      expect(Number.parseFloat(caption.style.fontSize)).toBeCloseTo(width * 9 / 16 * 0.25)
    }
    expect(caption.style.maxWidth).toBe("80%")
    expect(frame.style.minHeight).toBe("368px")
    expectCaptionFits()

    openCustom()
    const initialPadding = caption.style.padding
    fireEvent.change(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" }), { target: { value: "72" } })
    await waitFor(() => expect(savedStyle(store).backgroundOpacity).toBe(72))
    expect(frame.style.minHeight).toBe("368px")
    expect(caption.style.padding).toBe(initialPadding)
    expectCaptionFits()

    width = 240
    captionHeight = 420
    act(() => resizePreview())
    expect(frame.style.minHeight).toBe("444px")
    expectCaptionFits()
    expect(savedStyle(store).relativeFontSize).toBe(25)

    captionHeight = 64
    fireEvent.click(screen.getByRole("button", { name: "100%" }))
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(5))
    expect(caption.style.fontSize).toBe("6.75px")
    expect(frame.style.minHeight).toBe("88px")
    expect(scene.getBoundingClientRect().height).toBe(135)
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
      if (this.classList.contains("subtitle-preview-scene")) {
        const aspect = this.parentElement!.dataset.aspect
        const width = aspect === "landscape" ? 640 : 285
        const height = width * (aspect === "portrait" ? 16 / 9 : aspect === "square" ? 1 : 9 / 16)
        return new DOMRect(0, 0, width, Math.max(height, Number.parseFloat(this.parentElement!.style.minHeight) || 0))
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
    expect(caption.style.fontSize).toBe("18px")
    for (const aspect of ["portrait", "square", "landscape"] as const) {
      fireEvent.click(formats.getByRole("button", { name: `subtitleStyle.previewAspectRatios.${aspect}` }))
      expect(frame).toHaveAttribute("data-aspect", aspect)
      expect(formats.getByRole("button", { name: `subtitleStyle.previewAspectRatios.${aspect}` })).toHaveAttribute("aria-pressed", "true")
      expect(caption.style.fontSize).toBe(aspect === "landscape" ? "18px" : "14.25px")
      expect(store.get(configAtom)).toEqual(initialConfig)
      expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(initialConfig)
    }
    fireEvent.click(formats.getByRole("button", { name: "subtitleStyle.previewAspectRatios.portrait" }))
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.compact" }))
    await waitFor(() => expect(savedStyle(store).preset).toBe("compact"))
    expect(caption.style.fontSize).toBe("11.4px")
    expect(caption.style.backgroundColor).toBe("rgba(15, 20, 35, 0.35)")
    fireEvent.click(formats.getByRole("button", { name: "subtitleStyle.previewAspectRatios.square" }))
    expect(caption.style.fontSize).toBe("11.4px")
    const current = store.get(configAtom)
    act(() => store.set(configAtom, { ...current, features: { ...current.features, subtitleMode: "translationOnly" } }))
    expect(screen.queryByText("subtitleStyle.previewOriginal")).toBeNull()
    expect(screen.getByText("subtitleStyle.previewTranslation")).toBeInTheDocument()
    fireEvent.keyDown(caption, { key: "ArrowLeft" })
    await waitFor(() => expect(savedStyle(store).position.x).toBe(48))
    expect(frame).toHaveAttribute("data-aspect", "square")
  })
})
