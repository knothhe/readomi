// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { TRANSLATION_NODE_STYLE } from "@/utils/constants/translation-node-style"
import { ReadingSection } from ".."

const customCSS = "[data-readomi-custom-translation-style='custom'] { color: red; }"

async function renderReading(config: Config = DEFAULT_CONFIG) {
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  const view = render(<Provider store={store}><ReadingSection /></Provider>)
  return { ...view, store }
}

function openMore() {
  fireEvent.click(screen.getByText("options.reading.moreOptions"))
}

async function openCustomCSS() {
  const summary = screen.getByText("options.reading.style.custom")
  const details = summary.closest("details")!
  if (!details.open)
    fireEvent.click(summary)
  return await screen.findByRole("textbox", { name: "options.reading.style.custom" })
}

describe("reading settings", () => {
  beforeEach(() => fakeBrowser.reset())
  afterEach(cleanup)

  it("enables input translation by default and persists the toggle without changing language rules", async () => {
    const { store } = await renderReading()
    const toggle = screen.getByRole("switch", { name: "inputTranslation.title" })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.inputTranslation).toBe(false))
    expect(store.get(configAtom).language).toEqual(DEFAULT_CONFIG.language)
  })

  it("offers every supported translation style and preserves custom CSS while a preset is selected", async () => {
    const config: Config = { ...DEFAULT_CONFIG, translate: { ...DEFAULT_CONFIG.translate, translationNodeStyle: { preset: "line", isCustom: true, customCSS } } }
    const { store } = await renderReading(config)
    const styles = within(screen.getByRole("group", { name: "options.reading.style.title" }))
    const buttons = styles.getAllByRole("button")
    expect(buttons).toHaveLength(TRANSLATION_NODE_STYLE.length)
    expect(buttons.map(button => button.textContent)).toEqual([
      "Aaoptions.reading.style.presets.line", "Aaoptions.reading.style.presets.default", "Aaoptions.reading.style.presets.weakened",
      "Aaoptions.reading.style.presets.textColor", "Aaoptions.reading.style.presets.background", "Aaoptions.reading.style.presets.dashedLine",
      "Aaoptions.reading.style.presets.blockquote", "Aaoptions.reading.style.presets.border", "Aaoptions.reading.style.presets.blur",
    ])
    expect(buttons.every(button => button.getAttribute("aria-pressed") === "false")).toBe(true)

    fireEvent.click(styles.getByRole("button", { name: "options.reading.style.presets.dashedLine" }))
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.translate.translationNodeStyle).toEqual({ preset: "dashedLine", isCustom: false, customCSS }))
    expect(styles.getByRole("button", { name: "options.reading.style.presets.dashedLine" })).toHaveAttribute("aria-pressed", "true")
    expect(store.get(configAtom).features).toEqual(config.features)
  })

  it("keeps bilingual styles out of translation-only mode without discarding the chosen style", async () => {
    const { store } = await renderReading()
    openMore()
    fireEvent.click(screen.getByRole("button", { name: "options.reading.mode.translationOnly" }))
    await waitFor(() => expect(store.get(configAtom).translate.mode).toBe("translationOnly"))
    expect(screen.queryByRole("group", { name: "options.reading.style.title" })).toBeNull()
    expect(screen.queryByText("options.reading.style.custom")).toBeNull()
    expect(screen.getByRole("switch", { name: "options.reading.wordPrefixEmphasis.title" })).toBeVisible()
    expect(screen.getByRole("link", { name: "siteRules.title" })).toHaveAttribute("href", "#reading/site-rules")

    fireEvent.click(screen.getByRole("button", { name: "options.reading.mode.bilingual" }))
    await waitFor(() => expect(screen.getByRole("group", { name: "options.reading.style.title" })).toBeVisible())
    expect(store.get(configAtom).translate.translationNodeStyle).toEqual(DEFAULT_CONFIG.translate.translationNodeStyle)
  })

  it("shows streaming only while hover translation is enabled and preserves its saved preference", async () => {
    const { store } = await renderReading()
    const hover = screen.getByRole("switch", { name: "features.hover" })
    expect(screen.queryByRole("switch", { name: "features.hoverStream" })).toBeNull()
    expect(store.get(configAtom).features.hoverStream).toBe(true)
    fireEvent.click(hover)
    const streaming = await screen.findByRole("switch", { name: "features.hoverStream" })
    expect(streaming).toBeChecked()
    fireEvent.click(streaming)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.hoverStream).toBe(false))
    fireEvent.click(hover)
    await waitFor(() => expect(screen.queryByRole("switch", { name: "features.hoverStream" })).toBeNull())
    fireEvent.click(hover)
    expect(await screen.findByRole("switch", { name: "features.hoverStream" })).not.toBeChecked()
  })

  it("validates CSS drafts, cancels without saving and only activates custom styling on save", async () => {
    const { store, container } = await renderReading()
    openMore()
    let editor = await openCustomCSS()
    fireEvent.change(editor, { target: { value: customCSS } })
    expect(store.get(configAtom).translate.translationNodeStyle).toEqual(DEFAULT_CONFIG.translate.translationNodeStyle)
    fireEvent.click(screen.getByRole("button", { name: "options.reading.style.css.cancel" }))
    expect(screen.queryByRole("textbox", { name: "options.reading.style.custom" })).toBeNull()
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.translate.translationNodeStyle).toEqual(DEFAULT_CONFIG.translate.translationNodeStyle)

    editor = await openCustomCSS()
    expect(editor).toHaveValue("")
    fireEvent.change(editor, { target: { value: "div { color: red;" } })
    await waitFor(() => expect(editor).toHaveAttribute("aria-invalid", "true"))
    expect(screen.getByRole("button", { name: "options.reading.style.css.save" })).toBeDisabled()
    fireEvent.change(editor, { target: { value: customCSS } })
    await waitFor(() => expect(screen.getByRole("button", { name: "options.reading.style.css.save" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "options.reading.style.css.save" }))
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.translate.translationNodeStyle).toEqual({ ...DEFAULT_CONFIG.translate.translationNodeStyle, isCustom: true, customCSS }))
    expect(container.querySelector("[data-readomi-custom-translation-style='custom']")).toHaveTextContent("阅读和经历")
  })
})
