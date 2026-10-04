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
const modes = () => within(screen.getByRole("group", { name: "subtitleStyle.fontSizeMode" }))
const savedStyle = (store: ReturnType<typeof createStore>) => store.get(configAtom).features.subtitleStyle

describe("subtitle settings", () => {
  it("keeps size mode in the main group and fine controls collapsed until requested", async () => {
    const { container, store } = await renderFeatures()
    const custom = container.querySelector<HTMLDetailsElement>(".subtitle-custom")!
    const more = container.querySelector<HTMLDetailsElement>(".subtitle-site-more")!
    expect(custom.open).toBe(false)
    expect(more.open).toBe(false)
    expect(screen.getByRole("switch", { name: "features.video" })).toBeVisible()
    expect(modes().getByRole("button", { name: "subtitleStyle.fontSizeModes.video" })).toBeVisible()
    expect(presets().getAllByRole("button")).toHaveLength(4)
    expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).not.toBeVisible()
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).not.toBeVisible()
    expect(screen.getByRole("group", { name: "subtitleStyle.position" })).not.toBeVisible()
    expect(screen.queryByRole("switch", { name: "subtitleStyle.background" })).toBeNull()

    fireEvent.click(modes().getByRole("button", { name: "subtitleStyle.fontSizeModes.fixed" }))
    await waitFor(() => expect(savedStyle(store).fontSizeMode).toBe("fixed"))
    expect(custom.open).toBe(false)
    fireEvent.click(presets().getByRole("button", { name: "subtitleStyle.presets.compact" }))
    await waitFor(() => expect(savedStyle(store)).toMatchObject({ ...subtitlePresetPatch("compact"), fontSizeMode: "fixed" }))
    expect(custom.open).toBe(false)
    openCustom()
    expect(screen.getByRole("slider", { name: "subtitleStyle.fontSize" })).toBeVisible()
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })).toHaveValue(16)
    expect(screen.getByRole("slider", { name: "subtitleStyle.backgroundOpacity" })).toBeVisible()
    expect(screen.getByRole("group", { name: "subtitleStyle.position" })).toBeVisible()
    expect(within(custom).queryByRole("group", { name: "subtitleStyle.fontSizeMode" })).toBeNull()
    expect(more.open).toBe(false)
  })

  it("keeps independent size values, changes units and resets only position", async () => {
    const original = { fontSize: 38, relativeFontSize: 5.9375, position: { x: 60, y: 65 } }
    const { store } = await renderFeatures(original)
    openCustom()
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })).toHaveValue(5.9375)
    expect(within(screen.getByRole("group", { name: "subtitleStyle.commonSizes" })).getAllByRole("button").map(button => button.textContent)).toEqual(["2.5%", "3%", "3.75%", "4.5%"])
    fireEvent.click(modes().getByRole("button", { name: "subtitleStyle.fontSizeModes.fixed" }))
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })).toHaveValue(38)
    fireEvent.click(screen.getByRole("button", { name: "24 px" }))
    await waitFor(() => expect(savedStyle(store).fontSize).toBe(24))
    fireEvent.click(modes().getByRole("button", { name: "subtitleStyle.fontSizeModes.video" }))
    expect(screen.getByRole("spinbutton", { name: "subtitleStyle.fontSize" })).toHaveValue(5.9375)
    expect(savedStyle(store).fontSize).toBe(24)
    fireEvent.click(screen.getByRole("button", { name: "subtitleStyle.resetPosition" }))
    await waitFor(() => expect(savedStyle(store).position).toEqual(SUBTITLE_POSITIONS.bottom))
    expect(savedStyle(store)).toMatchObject({ fontSize: 24, relativeFontSize: 5.9375, fontSizeMode: "video" })
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.subtitleStyle).toMatchObject({ fontSize: 24, relativeFontSize: 5.9375 })
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
    fireEvent.change(screen.getByRole("slider", { name: "subtitleStyle.fontSize" }), { target: { value: "5" } })
    await waitFor(() => expect(savedStyle(store).relativeFontSize).toBe(5))
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
    const { store } = await renderFeatures({ fontSizeMode: "fixed", fontSize: 80, backgroundEnabled: false, backgroundOpacity: 0 })
    const caption = screen.getByRole("group", { name: "subtitleStyle.previewDragLabel" })
    const scene = caption.parentElement!
    const frame = scene.parentElement!
    const expectCaptionFits = () => {
      const height = scene.getBoundingClientRect().height
      const bottom = Number.parseFloat(caption.style.top) / 100 * height
      expect(bottom - captionHeight).toBeGreaterThanOrEqual(12)
      expect(bottom).toBeLessThan(height)
      expect(caption.style.fontSize).toBe("80px")
    }
    expect(caption.style.maxWidth).toBe("calc(100% - 16px)")
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
    expect(savedStyle(store).fontSize).toBe(80)

    captionHeight = 64
    fireEvent.click(screen.getByRole("button", { name: "20 px" }))
    await waitFor(() => expect(savedStyle(store).fontSize).toBe(20))
    expect(caption.style.fontSize).toBe("20px")
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
})
