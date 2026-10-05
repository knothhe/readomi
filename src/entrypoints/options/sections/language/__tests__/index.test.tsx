import type { ReactNode } from "react"
// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { toast } from "@/components/toast"
import { LanguageRow } from "@/entrypoints/popup/components/language-row"
import { configAtom } from "@/utils/atoms/config"
import { storageAdapter } from "@/utils/atoms/storage-adapter"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { setUILanguage } from "@/utils/ui-language"
import { LanguageSection } from ".."

const configured: Config = {
  ...DEFAULT_CONFIG,
  language: { ...DEFAULT_CONFIG.language, secondaryCode: "eng" },
  ui: { language: "zh-CN" },
  providersConfig: DEFAULT_CONFIG.providersConfig.map(provider => ({ ...provider, apiKey: "existing-key", headers: { "X-Test": "kept" } })),
  features: { ...DEFAULT_CONFIG.features, hoverHotkey: "backtick", videoSubtitles: true, subtitleMode: "translationOnly" },
}

async function renderLanguages(node: ReactNode = <LanguageSection />, config = configured) {
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  const view = render(<Provider store={store}>{node}</Provider>)
  return { ...view, store }
}

function choose(label: string, value: string) {
  fireEvent.click(screen.getByRole("button", { name: label }))
  const option = screen.getAllByRole("option").find(item => item.getAttribute("data-value") === value)
  expect(option).toBeDefined()
  fireEvent.click(option!)
}

describe("translation language settings and popup", () => {
  beforeEach(() => {
    fakeBrowser.reset()
    setUILanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    setUILanguage("browser")
    vi.restoreAllMocks()
  })

  it("shows configured bidirectional rules and saves only the selected language field", async () => {
    const { store } = await renderLanguages()
    expect(screen.getByRole("button", { name: "主要语言" })).toHaveTextContent("简体中文")
    expect(screen.getByRole("button", { name: "第二语言" })).toHaveTextContent("英语")
    expect(screen.getByText("原文为其他语言时，译成「简体中文」。")).toBeInTheDocument()
    expect(screen.getByText("原文为「简体中文」时，译成「英语」。")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "源语言" })).toBeNull()
    choose("主要语言", "jpn")
    await waitFor(async () => expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...configured, language: { ...configured.language, targetCode: "jpn" } }))
    expect(store.get(configAtom).language.secondaryCode).toBe("eng")
    expect(screen.getByText("原文为「日语」时，译成「英语」。")).toBeInTheDocument()
  })

  it("keeps the original once in both preview modes without changing actual display modes", async () => {
    const { container, store } = await renderLanguages()
    choose("第二语言", "original")
    const preview = container.querySelector("[data-preview=\"primary\"]")!
    await waitFor(() => expect(preview).toHaveAttribute("data-preserved", "true"))
    expect(preview.querySelectorAll(".language-preview-original")).toHaveLength(1)
    expect(preview.querySelector(".language-preview-translation")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "仅译文" }))
    expect(preview).toHaveTextContent("先读懂世界，再表达自己。")
    expect(preview.querySelectorAll(".language-preview-original")).toHaveLength(1)
    expect(preview.querySelector(".language-preview-translation")).toBeNull()
    expect(store.get(configAtom).translate.mode).toBe(configured.translate.mode)
    expect(store.get(configAtom).features.subtitleMode).toBe(configured.features.subtitleMode)
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.language.secondaryCode).toBe("original"))
  })

  it("allows same-family choices without resetting either selected language", async () => {
    const { container, store } = await renderLanguages()
    choose("第二语言", "cmn-Hant")
    expect(screen.getByRole("button", { name: "第二语言" })).toHaveAttribute("data-value", "cmn-Hant")
    expect(screen.getByText("主要语言和第二语言相同，该语言的内容将保持原文。")).toBeInTheDocument()
    expect(container.querySelector("[data-preview=\"primary\"]")).toHaveAttribute("data-preserved", "true")
    await waitFor(() => expect(store.get(configAtom).language).toEqual({ ...configured.language, secondaryCode: "cmn-Hant" }))
  })

  it("labels unsupported preview samples accurately without inventing a translation", async () => {
    const { container } = await renderLanguages()
    choose("主要语言", "arb")
    const other = container.querySelector("[data-preview=\"other\"]")!
    const primary = container.querySelector("[data-preview=\"primary\"]")!
    expect(other.querySelector(".language-preview-translation")).toBeNull()
    expect(other.querySelector(".language-preview-original")).toBeNull()
    expect(primary.querySelector(".language-preview-original")).toBeNull()
    expect(primary.querySelector(".language-preview-translation")).toBeNull()
    expect(other).toHaveTextContent("该语言暂无示例文本，实际翻译将使用你选择的语言。")
    expect(primary).toHaveTextContent("该语言暂无示例文本，实际翻译将使用你选择的语言。")
    expect(other.querySelector(".language-preview-direction")).toHaveTextContent("阿拉伯语")
  })

  it("uses the same two settings in the popup and makes its condition follow the primary language", async () => {
    const { store } = await renderLanguages(<LanguageRow />)
    expect(screen.getByText("其他语言")).toBeInTheDocument()
    choose("主要语言", "jpn")
    await waitFor(() => expect(store.get(configAtom).language.targetCode).toBe("jpn"))
    choose("第二语言", "original")
    expect(screen.getByText("日语内容只显示原文，不重复展示。")).toBeInTheDocument()
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.language).toEqual({ ...configured.language, targetCode: "jpn", secondaryCode: "original" }))
  })

  it("rolls back a failed language save and reports the failure", async () => {
    const { store } = await renderLanguages()
    const failure = vi.spyOn(toast, "error")
    vi.spyOn(storageAdapter, "set").mockRejectedValueOnce(new Error("storage unavailable"))
    choose("第二语言", "original")
    await waitFor(() => expect(failure).toHaveBeenCalledWith("未能保存翻译语言，请重试。"))
    expect(store.get(configAtom).language).toEqual(configured.language)
    expect(screen.getByRole("button", { name: "第二语言" })).toHaveAttribute("data-value", "eng")
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.language).toEqual(configured.language)
  })
})
