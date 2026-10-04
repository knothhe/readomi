// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLocalConfig, watchLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { removeAllTranslatedWrapperNodes, translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { createInlineHoverStreamPreview } from "@/utils/host/translate/ui/inline-hover-stream-preview"
import { bindHoverTranslation } from "../hover-translation"

vi.mock("@/utils/config/storage", () => ({ getLocalConfig: vi.fn(), watchLocalConfig: vi.fn(() => vi.fn()) }))
vi.mock("@/utils/host/translate/node-manipulation", () => ({ translateWalkedElement: vi.fn(), removeAllTranslatedWrapperNodes: vi.fn() }))
vi.mock("@/utils/host/translate/ui/inline-hover-stream-preview", () => ({ createInlineHoverStreamPreview: vi.fn(() => undefined) }))
vi.mock("@/utils/host/translate/translate-text", () => ({ validateTranslationConfigAndToast: () => true }))

let cleanup: () => void
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(getLocalConfig).mockResolvedValue({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } })
  document.body.innerHTML = "<p>Hello reader.</p><input>"
  cleanup = bindHoverTranslation()
  document.querySelector("p")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})
const down = (key = "Alt") => document.dispatchEvent(new KeyboardEvent("keydown", { key }))
const up = (key = "Alt") => document.dispatchEvent(new KeyboardEvent("keyup", { key }))
const keyboardTriggers = [["alt", "Alt"], ["control", "Control"], ["shift", "Shift"], ["backtick", "`"]] as const

describe("tap-or-hold hover translation", () => {
  it("waits for the complete formula renderer without previewing request placeholders", async () => {
    document.querySelector("p")!.innerHTML = "The formula <math><mi>x</mi></math> is useful."
    down()
    up()
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledOnce()
    expect(createInlineHoverStreamPreview).not.toHaveBeenCalled()
  })

  it("removes completed hover results when site rules change or the page navigates", () => {
    const previous = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } }
    const next = { ...previous, siteRules: { userRules: [], disabledBuiltInRules: ["twitter"] } }
    vi.mocked(watchLocalConfig).mock.calls[0][0](next, previous)
    expect(removeAllTranslatedWrapperNodes).toHaveBeenCalledWith(document)
    window.dispatchEvent(new CustomEvent("extension:URLChange", { detail: { from: "/one", to: "/two" } }))
    expect(removeAllTranslatedWrapperNodes).toHaveBeenCalledTimes(2)
  })

  it("keeps completed paragraphs and reads the selected service on the next hover", async () => {
    const nextProvider = { ...DEFAULT_CONFIG.providersConfig[0], id: "second-service", name: "Second service" }
    const previous = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true }, providersConfig: [...DEFAULT_CONFIG.providersConfig, nextProvider] }
    const next = { ...previous, translate: { ...previous.translate, providerId: nextProvider.id } }
    vi.mocked(getLocalConfig).mockResolvedValue(previous)
    down()
    up()
    await vi.advanceTimersByTimeAsync(0)
    const first = document.querySelector("p")!
    const existingTranslation = document.createElement("span")
    existingTranslation.textContent = "已有译文"
    first.append(existingTranslation)

    vi.mocked(getLocalConfig).mockResolvedValue(next)
    vi.mocked(watchLocalConfig).mock.calls[0][0](next, previous)
    const second = document.createElement("p")
    second.textContent = "Second paragraph."
    document.body.append(second)
    second.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    down()
    up()
    await vi.advanceTimersByTimeAsync(0)

    expect(translateWalkedElement).toHaveBeenLastCalledWith(second, expect.any(String), next, true, expect.any(AbortSignal), expect.any(Function))
    expect(removeAllTranslatedWrapperNodes).not.toHaveBeenCalled()
    expect(existingTranslation.isConnected).toBe(true)
  })

  it.each(keyboardTriggers)("translates on release after a short %s tap", async (hotkey, key) => {
    vi.mocked(getLocalConfig).mockResolvedValue({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: hotkey } })
    down(key)
    await vi.advanceTimersByTimeAsync(100)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    up(key)
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
  })
  it.each(keyboardTriggers)("translates a held %s key once, including after release", async (hotkey, key) => {
    vi.mocked(getLocalConfig).mockResolvedValue({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: hotkey } })
    down(key)
    await vi.advanceTimersByTimeAsync(499)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new KeyboardEvent("keydown", { key, repeat: true }))
    up(key)
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
  })
  it("does not duplicate a held trigger while its configuration read is pending", async () => {
    let resolveConfig!: (config: typeof DEFAULT_CONFIG) => void
    vi.mocked(getLocalConfig).mockReturnValue(new Promise(resolve => resolveConfig = resolve))
    down()
    await vi.advanceTimersByTimeAsync(500)
    up()
    expect(getLocalConfig).toHaveBeenCalledTimes(1)
    resolveConfig({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } })
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
  })
  it("uses the paragraph under the mouse when the tap is released", async () => {
    const next = document.createElement("p")
    next.textContent = "Another paragraph."
    document.body.append(next)
    down()
    next.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    up()
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledWith(next, expect.any(String), expect.any(Object), true, expect.any(AbortSignal), expect.any(Function))
  })
  it.each([["control", "Control"], ["shift", "Shift"], ["backtick", "`"]] as const)("uses the configured %s trigger instead of Alt", async (hotkey, key) => {
    vi.mocked(getLocalConfig).mockResolvedValue({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: hotkey } })
    down()
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }))
    down(key)
    await vi.advanceTimersByTimeAsync(500)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
  })
  it("supports mouse hold and cancels dragging or early release", async () => {
    vi.mocked(getLocalConfig).mockResolvedValue({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: "clickAndHold" } })
    const p = document.querySelector("p")!
    p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }))
    p.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 30, clientY: 10 }))
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    await vi.advanceTimersByTimeAsync(500)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
  })
  it("requires 500ms and translates only the hovered paragraph with toggle enabled", async () => {
    down()
    await vi.advanceTimersByTimeAsync(499)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(translateWalkedElement).toHaveBeenCalledWith(document.querySelector("p"), expect.any(String), expect.any(Object), true, expect.any(AbortSignal), expect.any(Function))
  })
  it.each([true, false])("cancels keyboard combinations in either press order (trigger first: %s)", async (triggerFirst) => {
    down(triggerFirst ? "Alt" : "e")
    down(triggerFirst ? "e" : "Alt")
    await vi.advanceTimersByTimeAsync(600)
    up("e")
    up()
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    down()
    up()
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
  })
  it("cancels on another key and invalidation", async () => {
    down()
    down("e")
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    up("e")
    up()
    down()
    cleanup()
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })
  it("recovers after Shift changes the character of a pressed key", async () => {
    vi.mocked(getLocalConfig).mockResolvedValue({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: "backtick" } })
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "`", code: "Backquote" }))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft", shiftKey: true }))
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "~", code: "Backquote", shiftKey: true }))
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", code: "ShiftLeft" }))
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    down("`")
    up("`")
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
  })
  it("cancels a held key on blur and allows the next tap", async () => {
    down()
    window.dispatchEvent(new Event("blur"))
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    down()
    up()
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledTimes(1)
  })
  it("cancels a pending tap when the content script is invalidated", async () => {
    let resolveConfig!: (config: typeof DEFAULT_CONFIG) => void
    vi.mocked(getLocalConfig).mockReturnValue(new Promise(resolve => resolveConfig = resolve))
    down()
    up()
    cleanup()
    resolveConfig({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } })
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })
  it("does not translate when disabled or typing in a field", async () => {
    vi.mocked(getLocalConfig).mockResolvedValue(DEFAULT_CONFIG)
    down()
    up()
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }))
    vi.mocked(getLocalConfig).mockResolvedValue({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } })
    document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }))
    document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }))
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })
})
