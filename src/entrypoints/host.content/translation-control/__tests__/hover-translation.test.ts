// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
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
let pageListeners: AbortController
beforeEach(async () => {
  vi.useFakeTimers()
  vi.mocked(translateWalkedElement).mockReset()
  pageListeners = new window.AbortController()
  vi.mocked(getLocalConfig).mockResolvedValue({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } })
  document.body.innerHTML = "<p>Hello reader.</p><input>"
  cleanup = bindHoverTranslation()
  document.querySelector("p")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
  await vi.advanceTimersByTimeAsync(0)
  vi.mocked(getLocalConfig).mockClear()
})
afterEach(() => {
  pageListeners.abort()
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})
const down = (key = "Alt") => document.dispatchEvent(new KeyboardEvent("keydown", { key }))
const up = (key = "Alt") => document.dispatchEvent(new KeyboardEvent("keyup", { key }))
const keyboardTriggers = [["alt", "Alt"], ["control", "Control"], ["shift", "Shift"], ["backtick", "`"]] as const
function setConfig(config: Config) {
  vi.mocked(getLocalConfig).mockResolvedValue(config)
  vi.mocked(watchLocalConfig).mock.calls.at(-1)![0](config, null)
}
const backtickConfig = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: "backtick" as const } }
function backtick(type: "keydown" | "keyup", init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent(type, { key: "`", code: "Backquote", bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe("backtick ownership before the page routes typing into its editor", () => {
  beforeEach(() => setConfig(backtickConfig))

  it("translates a tap without letting document capture or later window listeners focus the editor", async () => {
    const input = document.querySelector("input")!
    const routeToEditor = vi.fn((event: Event) => {
      input.focus()
      input.value += (event as KeyboardEvent).key
    })
    const release = vi.fn()
    document.addEventListener("keydown", routeToEditor, { capture: true, signal: pageListeners.signal })
    window.addEventListener("keydown", routeToEditor, { capture: true, signal: pageListeners.signal })
    document.addEventListener("keyup", release, { capture: true, signal: pageListeners.signal })

    expect(backtick("keydown").defaultPrevented).toBe(true)
    expect(backtick("keyup").defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(routeToEditor).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    expect(input.value).toBe("")
    expect(document.activeElement).toBe(document.body)
    expect(translateWalkedElement).toHaveBeenCalledOnce()

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true, cancelable: true }))
    expect(routeToEditor).toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })

  it("consumes repeats and release while translating a held key only once", async () => {
    backtick("keydown")
    await vi.advanceTimersByTimeAsync(500)
    expect(backtick("keydown", { repeat: true }).defaultPrevented).toBe(true)
    expect(backtick("keyup").defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).toHaveBeenCalledOnce()
  })

  it.each(["combination", "settings", "mouse", "route"])("keeps ownership until physical release after %s cancels translation", async (reason) => {
    backtick("keydown")
    if (reason === "combination")
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft", shiftKey: true, bubbles: true }))
    else if (reason === "settings")
      setConfig({ ...backtickConfig, features: { ...backtickConfig.features, hoverTranslation: false } })
    else if (reason === "mouse")
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    else
      window.dispatchEvent(new CustomEvent("extension:URLChange"))
    expect(backtick("keydown", { key: "~", shiftKey: true, repeat: true }).defaultPrevented).toBe(true)
    expect(backtick("keyup", { key: "~", shiftKey: true }).defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()

    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", code: "ShiftLeft", bubbles: true }))
    setConfig(backtickConfig)
    expect(backtick("keydown").defaultPrevented).toBe(true)
    backtick("keyup")
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledOnce()
  })

  it.each(["input", "textarea", "contenteditable"])("leaves focused %s input alone while the mouse remains over a message", async (kind) => {
    const editor = document.createElement(kind === "contenteditable" ? "div" : kind)
    if (kind === "contenteditable") {
      editor.setAttribute("contenteditable", "true")
      // jsdom does not implement the browser's isContentEditable property.
      Object.defineProperty(editor, "isContentEditable", { value: true })
    }
    document.body.append(editor)
    editor.focus()
    const handler = vi.fn()
    document.addEventListener("keydown", handler, { capture: true, signal: pageListeners.signal })
    expect(backtick("keydown", {}, editor).defaultPrevented).toBe(false)
    expect(backtick("keyup", {}, editor).defaultPrevented).toBe(false)
    await vi.advanceTimersByTimeAsync(600)
    expect(handler).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(editor)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })

  it("does not claim a retargeted event from a shadow editor", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const shadow = host.attachShadow({ mode: "open" })
    const input = document.createElement("input")
    shadow.append(input)
    input.focus()
    expect(backtick("keydown", { composed: true }, input).defaultPrevented).toBe(false)
    backtick("keyup", { composed: true }, input)
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })

  it.each([
    { isComposing: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true },
  ])("leaves composition and modified keys alone: %s", async (init) => {
    expect(backtick("keydown", init).defaultPrevented).toBe(false)
    expect(backtick("keyup", init).defaultPrevented).toBe(false)
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })

  it.each([false, "alt"] as const)("does not claim backtick when disabled or configured for another trigger: %s", async (setting) => {
    setConfig({ ...backtickConfig, features: { ...backtickConfig.features, hoverTranslation: setting !== false, hoverHotkey: setting || "backtick" } })
    expect(backtick("keydown").defaultPrevented).toBe(false)
    expect(backtick("keyup").defaultPrevented).toBe(false)
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })

  it.each(["empty", "hidden", "excluded", "editable", "document", "detached"])("does not claim over a %s hover target", async (kind) => {
    const paragraph = document.querySelector("p")!
    if (kind === "empty")
      paragraph.textContent = ""
    else if (kind === "hidden")
      paragraph.hidden = true
    else if (kind === "excluded")
      paragraph.classList.add("notranslate")
    else if (kind === "editable")
      paragraph.setAttribute("contenteditable", "true")
    else if (kind === "document")
      document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    else
      paragraph.remove()
    expect(backtick("keydown").defaultPrevented).toBe(false)
    backtick("keyup")
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })

  it("respects the configured include scope before claiming the key", async () => {
    setConfig({ ...backtickConfig, siteRules: { ...backtickConfig.siteRules, userRules: [{ id: "only-article", matches: "*://*/*", includeSelectors: ["article"] }] } })
    expect(backtick("keydown").defaultPrevented).toBe(false)
    backtick("keyup")
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })

  it("can translate an included inline descendant of a block outside the include scope", async () => {
    const paragraph = document.querySelector("p")!
    paragraph.innerHTML = "<span class='allowed' style='display:inline'>Readable message.</span>"
    const span = paragraph.querySelector("span")!
    span.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    setConfig({ ...backtickConfig, siteRules: { ...backtickConfig.siteRules, userRules: [{ id: "inline-source", matches: "*://*/*", includeSelectors: [".allowed"] }] } })
    expect(backtick("keydown").defaultPrevented).toBe(true)
    backtick("keyup")
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledWith(paragraph, expect.any(String), expect.any(Object), true, expect.any(AbortSignal), expect.any(Function))
  })

  it("keeps explicit translation groups eligible independently of the include scope", async () => {
    const paragraph = document.querySelector("p")!
    paragraph.id = "group"
    paragraph.innerHTML = "<span id='source'>Readable grouped message.</span>"
    setConfig({ ...backtickConfig, siteRules: { ...backtickConfig.siteRules, userRules: [{
      id: "group-source",
      matches: "*://*/*",
      includeSelectors: ["#other"],
      translationGroups: [{ containerSelector: "#group", sourceSelectors: ["#source"] }],
    }] } })
    expect(backtick("keydown").defaultPrevented).toBe(true)
    backtick("keyup")
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledOnce()
  })

  it("lets keys through before config is ready and ignores a stale initial config", async () => {
    cleanup()
    let resolveConfig!: (config: Config) => void
    vi.mocked(getLocalConfig).mockReturnValueOnce(new Promise(resolve => resolveConfig = resolve))
    cleanup = bindHoverTranslation()
    document.querySelector("p")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    expect(backtick("keydown").defaultPrevented).toBe(false)
    backtick("keyup")

    setConfig(backtickConfig)
    resolveConfig(DEFAULT_CONFIG)
    await vi.advanceTimersByTimeAsync(0)
    expect(backtick("keydown").defaultPrevented).toBe(true)
    backtick("keyup")
    await vi.advanceTimersByTimeAsync(0)
    expect(translateWalkedElement).toHaveBeenCalledOnce()
  })

  it("cleans up the window listeners and discards a late initial config", async () => {
    cleanup()
    let resolveConfig!: (config: Config) => void
    vi.mocked(getLocalConfig).mockReturnValueOnce(new Promise(resolve => resolveConfig = resolve))
    cleanup = bindHoverTranslation()
    document.querySelector("p")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    cleanup()
    resolveConfig(backtickConfig)
    await vi.advanceTimersByTimeAsync(0)
    expect(backtick("keydown").defaultPrevented).toBe(false)
    backtick("keyup")
    await vi.advanceTimersByTimeAsync(600)
    expect(translateWalkedElement).not.toHaveBeenCalled()
  })
})

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

  it.each([
    { targetCode: "jpn" as const },
    { secondaryCode: "eng" as const },
  ])("clears completed paragraphs after language rules change: %s", (patch) => {
    const previous = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } }
    const next = { ...previous, language: { ...previous.language, ...patch } }
    vi.mocked(watchLocalConfig).mock.calls[0][0](next, previous)
    expect(removeAllTranslatedWrapperNodes).toHaveBeenCalledWith(document)
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
    setConfig({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: hotkey } })
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
    setConfig({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: hotkey } })
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
    setConfig({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true, hoverHotkey: hotkey } })
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
    setConfig(backtickConfig)
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

describe("independent hover translation tasks", () => {
  function pendingTranslations() {
    const tasks: { element: HTMLElement, signal: AbortSignal, finish: () => void }[] = []
    vi.mocked(translateWalkedElement).mockImplementation((element, _walkId, _config, _toggle, signal) => new Promise<void>((resolve) => {
      tasks.push({ element, signal: signal!, finish: resolve })
      signal!.addEventListener("abort", () => resolve(), { once: true })
    }))
    return tasks
  }
  function secondParagraph() {
    const paragraph = document.createElement("p")
    paragraph.textContent = "Another paragraph stays independent."
    document.body.append(paragraph)
    return paragraph
  }
  async function tap(element: Element, key = "Alt") {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    down(key)
    up(key)
    await vi.advanceTimersByTimeAsync(0)
  }

  it.each(keyboardTriggers)("accepts a new paragraph while the first %s translation is pending", async (hotkey, key) => {
    setConfig({ ...backtickConfig, features: { ...backtickConfig.features, hoverHotkey: hotkey } })
    const tasks = pendingTranslations()
    const first = document.querySelector("p")!
    const second = secondParagraph()
    await tap(first, key)
    await tap(second, key)
    expect(tasks.map(task => task.element)).toEqual([first, second])
    expect(tasks.every(task => !task.signal.aborted)).toBe(true)
    tasks[0].finish()
    await vi.advanceTimersByTimeAsync(0)
    await tap(second, key)
    expect(tasks).toHaveLength(2)
    expect(tasks[1].signal.aborted).toBe(false)
    // The completed first paragraph may be triggered again independently.
    await tap(first, key)
    expect(tasks).toHaveLength(3)
    expect(tasks[1].signal.aborted).toBe(false)
  })

  it("accepts consecutive mouse holds without cancelling earlier paragraphs", async () => {
    setConfig({ ...backtickConfig, features: { ...backtickConfig.features, hoverHotkey: "clickAndHold" } })
    const tasks = pendingTranslations()
    for (const paragraph of [document.querySelector("p")!, secondParagraph()]) {
      paragraph.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      await vi.advanceTimersByTimeAsync(500)
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    }
    expect(tasks).toHaveLength(2)
    expect(tasks.every(task => !task.signal.aborted)).toBe(true)
  })

  it("keeps both accepted targets when configuration reads resolve in reverse order", async () => {
    const tasks = pendingTranslations()
    const first = document.querySelector("p")!
    const second = secondParagraph()
    const reads: ((config: typeof DEFAULT_CONFIG) => void)[] = []
    vi.mocked(getLocalConfig).mockImplementation(() => new Promise(resolve => reads.push(resolve)))
    await tap(first)
    await tap(second)
    const config = { ...backtickConfig, features: { ...backtickConfig.features, hoverHotkey: "alt" as const } }
    reads[1](config)
    await vi.advanceTimersByTimeAsync(0)
    reads[0](config)
    await vi.advanceTimersByTimeAsync(0)
    expect(tasks.map(task => task.element)).toEqual([second, first])
    expect(tasks.every(task => !task.signal.aborted)).toBe(true)
  })

  it("does not walk the same paragraph, an inline child or an overlapping ancestor twice", async () => {
    const tasks = pendingTranslations()
    const first = document.querySelector("p")!
    first.innerHTML = "Reading <em>another idea</em> together."
    const parent = document.createElement("section")
    first.replaceWith(parent)
    parent.append(first, secondParagraph())
    await tap(first)
    await tap(first.querySelector("em")!)
    await tap(parent)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].signal.aborted).toBe(false)
  })

  it("continues claiming backtick while a pending replacement hides its original", async () => {
    setConfig(backtickConfig)
    const tasks = pendingTranslations()
    const first = document.querySelector("p")!
    await tap(first, "`")
    first.style.visibility = "hidden"
    expect(backtick("keydown").defaultPrevented).toBe(true)
    expect(backtick("keyup").defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].signal.aborted).toBe(false)
  })

  it("resolves visible shadow preview text back to its pending paragraph", async () => {
    setConfig(backtickConfig)
    const tasks = pendingTranslations()
    const first = document.querySelector("p")!
    await tap(first, "`")
    const preview = document.createElement("span")
    preview.className = "readomi-translated-content-wrapper"
    preview.dataset.readomiInlinePreview = "true"
    first.append(preview)
    first.style.visibility = "hidden"
    const shadow = preview.attachShadow({ mode: "open" })
    shadow.innerHTML = "<div style='display:block;visibility:visible'>正在逐步显示译文</div>"
    shadow.querySelector("div")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, composed: true }))
    expect(backtick("keydown").defaultPrevented).toBe(true)
    expect(backtick("keyup").defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].signal.aborted).toBe(false)
  })

  it("deduplicates a declared group by its owner while another group starts", async () => {
    const tasks = pendingTranslations()
    const first = document.querySelector("p")!
    const second = secondParagraph()
    first.className = second.className = "card"
    first.innerHTML = "<span class='source'>First source paragraph.</span><span class='source'>Second source paragraph.</span>"
    second.innerHTML = "<span class='source'>Another card's source paragraph.</span>"
    setConfig({ ...backtickConfig, siteRules: { ...backtickConfig.siteRules, userRules: [{
      id: "cards", matches: "*://*/*", includeSelectors: [".source"],
      translationGroups: [{ containerSelector: ".card", sourceSelectors: [".source"] }],
    }] } })
    await tap(first.children[0], "`")
    await tap(first.children[1], "`")
    await tap(second.children[0], "`")
    expect(tasks.map(task => task.element)).toEqual([first, second])
    expect(tasks.every(task => !task.signal.aborted)).toBe(true)
  })

  it("a paragraph's cancel action leaves another paragraph running", async () => {
    const tasks = pendingTranslations()
    await tap(document.querySelector("p")!)
    await tap(secondParagraph())
    const request = vi.mocked(translateWalkedElement).mock.calls[0][5]!
    request.cancel!()
    await vi.advanceTimersByTimeAsync(0)
    expect(tasks[0].signal.aborted).toBe(true)
    expect(tasks[1].signal.aborted).toBe(false)
  })

  it.each(["escape", "route", "settings", "cleanup"])("cancels all pending paragraphs on %s and allows no deferred starts", async (reason) => {
    const tasks = pendingTranslations()
    await tap(document.querySelector("p")!)
    await tap(secondParagraph())
    let resolveConfig!: (config: typeof DEFAULT_CONFIG) => void
    vi.mocked(getLocalConfig).mockReturnValue(new Promise(resolve => resolveConfig = resolve))
    await tap(secondParagraph())
    if (reason === "escape")
      down("Escape")
    else if (reason === "route")
      window.dispatchEvent(new CustomEvent("extension:URLChange"))
    else if (reason === "settings")
      setConfig(DEFAULT_CONFIG)
    else
      cleanup()
    resolveConfig({ ...backtickConfig, features: { ...backtickConfig.features, hoverHotkey: "alt" } })
    await vi.advanceTimersByTimeAsync(0)
    expect(tasks).toHaveLength(2)
    expect(tasks.every(task => task.signal.aborted)).toBe(true)
  })
})
