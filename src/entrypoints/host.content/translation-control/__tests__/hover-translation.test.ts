// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { bindHoverTranslation } from "../hover-translation"

vi.mock("@/utils/config/storage", () => ({ getLocalConfig: vi.fn() }))
vi.mock("@/utils/host/translate/node-manipulation", () => ({ translateWalkedElement: vi.fn() }))
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

describe("held hover translation", () => {
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
    expect(translateWalkedElement).toHaveBeenCalledWith(document.querySelector("p"), expect.any(String), expect.any(Object), true, expect.any(AbortSignal))
  })
  it("cancels on another key, release and invalidation", async () => {
    down()
    down("e")
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    down()
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }))
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    down()
    cleanup()
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })
  it("does not translate when disabled or typing in a field", async () => {
    vi.mocked(getLocalConfig).mockResolvedValue(DEFAULT_CONFIG)
    down()
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }))
    document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }))
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })
})
