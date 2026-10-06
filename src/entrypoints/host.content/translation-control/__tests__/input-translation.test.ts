// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { bindInputTranslation } from "../input-translation"

const { translate, replace, errorToast, getConfig, watchConfig, validate } = vi.hoisted(() => ({
  translate: vi.fn(),
  replace: vi.fn(),
  errorToast: vi.fn(),
  getConfig: vi.fn(),
  watchConfig: vi.fn(),
  validate: vi.fn(),
}))
vi.mock("@/utils/site-rules/preview-config", () => ({ getHostConfig: getConfig, watchHostConfig: watchConfig }))
vi.mock("@/utils/host/translate/translate-variants", () => ({ translateTextForInput: translate }))
vi.mock("@/utils/host/translate/translate-text", () => ({ validateTranslationConfigAndToast: validate }))
vi.mock("@/utils/input-translation/replace-text", () => ({ replaceEditableText: replace }))
vi.mock("@/components/toast", () => ({ toast: { error: errorToast } }))
let dispose: () => void
let changed: (config: Config | null) => void

function input(tag = "textarea", type = "text") {
  const field = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement
  if (field instanceof HTMLInputElement)
    field.type = type
  field.value = "Please confirm the meeting time for tomorrow.  "
  document.body.append(field)
  field.focus()
  return field
}
function press(target: Element, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true, composed: true, ...init })
  target.dispatchEvent(event)
  return event
}
function triple(target: Element, init: KeyboardEventInit = {}) {
  press(target, init)
  vi.advanceTimersByTime(100)
  press(target, init)
  vi.advanceTimersByTime(100)
  return press(target, init)
}
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("triple-space input translation", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    document.body.innerHTML = ""
    getConfig.mockResolvedValue(DEFAULT_CONFIG)
    watchConfig.mockImplementation((listener) => {
      changed = listener
      return vi.fn()
    })
    validate.mockReturnValue(true)
    translate.mockResolvedValue("请确认明天的会议时间。")
    replace.mockResolvedValue(true)
    dispose = await bindInputTranslation()
  })
  afterEach(() => {
    dispose()
    vi.useRealTimers()
  })

  it("translates only the third separate space and uses the current shared settings", async () => {
    const field = input()
    expect(press(field).defaultPrevented).toBe(false)
    expect(press(field).defaultPrevented).toBe(false)
    expect(translate).not.toHaveBeenCalled()
    expect(press(field).defaultPrevented).toBe(true)
    await flush()
    expect(translate).toHaveBeenCalledWith(field.value.trim(), DEFAULT_CONFIG, expect.any(AbortSignal))
    expect(replace).toHaveBeenCalledWith(field, "请确认明天的会议时间。", field.value, expect.any(AbortSignal))
    expect(document.querySelector(".readomi-input-pending")).toBeNull()
  })

  it("requires each consecutive interval to be at most 300 ms and resets on other keys or editors", () => {
    const first = input()
    press(first)
    vi.advanceTimersByTime(301)
    press(first)
    press(first, { key: "a" })
    press(first)
    const second = input()
    press(second)
    press(second)
    expect(translate).not.toHaveBeenCalled()
    press(second)
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it.each([{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])("ignores held, composing or modified spaces: %j", (init) => {
    triple(input(), init)
    expect(translate).not.toHaveBeenCalled()
  })

  it.each(["password", "number", "checkbox"])("leaves %s inputs alone", (type) => {
    triple(input("input", type))
    expect(translate).not.toHaveBeenCalled()
  })

  it("leaves empty, readonly and disabled fields alone", () => {
    const field = input()
    field.value = "   "
    expect(triple(field).defaultPrevented).toBe(false)
    field.value = "Original"
    field.readOnly = true
    triple(field)
    field.readOnly = false
    field.disabled = true
    triple(field)
    expect(translate).not.toHaveBeenCalled()
  })

  it("finds the input in an open shadow root", () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = host.attachShadow({ mode: "open" })
    const field = document.createElement("textarea")
    field.value = "Hello from a shadow root"
    root.append(field)
    field.focus()
    triple(field)
    expect(translate).toHaveBeenCalledWith(field.value, DEFAULT_CONFIG, expect.any(AbortSignal))
  })

  it("captures rich text with paragraph boundaries", () => {
    const editor = document.createElement("div")
    editor.tabIndex = 0
    Object.defineProperty(editor, "isContentEditable", { value: true })
    Object.defineProperty(editor, "innerText", { value: "First paragraph\nSecond paragraph  " })
    document.body.append(editor)
    editor.focus()
    triple(editor)
    expect(translate).toHaveBeenCalledWith("First paragraph\nSecond paragraph", DEFAULT_CONFIG, expect.any(AbortSignal))
  })

  it.each(["edit", "focus", "blur/refocus", "remove", "config", "disable", "dispose"])("discards a pending result after %s", async (action) => {
    let resolve!: (result: string) => void
    translate.mockReturnValue(new Promise<string>((done) => {
      resolve = done
    }))
    const field = input()
    triple(field)
    expect(document.querySelector(".readomi-input-pending")).not.toBeNull()
    if (action === "edit") {
      field.value = "New draft"
      field.dispatchEvent(new InputEvent("input", { bubbles: true }))
    }
    if (action === "focus")
      input()
    if (action === "blur/refocus") {
      field.blur()
      expect(document.querySelector(".readomi-input-pending")).toBeNull()
      field.focus()
    }
    if (action === "remove")
      field.remove()
    if (action === "config")
      changed({ ...DEFAULT_CONFIG, language: { ...DEFAULT_CONFIG.language, targetCode: "jpn" } })
    if (action === "disable")
      changed({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, inputTranslation: false } })
    if (action === "dispose")
      dispose()
    resolve("Late translation")
    await flush()
    expect(replace).not.toHaveBeenCalled()
    expect(document.querySelector(".readomi-input-pending")).toBeNull()
  })

  it("does not replace preserved text or show a failure", async () => {
    translate.mockResolvedValue("")
    triple(input())
    await flush()
    expect(replace).not.toHaveBeenCalled()
    expect(errorToast).not.toHaveBeenCalled()
  })

  it("prevents repeated requests while pending, keeps original text on failure and allows retry", async () => {
    let reject!: (error: Error) => void
    translate.mockReturnValueOnce(new Promise((_resolve, done) => {
      reject = done
    }))
    const field = input()
    const original = field.value
    triple(field)
    triple(field)
    expect(translate).toHaveBeenCalledTimes(1)
    reject(new Error("Offline"))
    await flush()
    expect(field.value).toBe(original)
    expect(errorToast).toHaveBeenCalledWith("inputTranslation.failed", expect.any(Object))
    expect(document.querySelector(".readomi-input-pending")).toBeNull()
    triple(field)
    expect(translate).toHaveBeenCalledTimes(2)
  })

  it("honors the live feature switch and checks service configuration", () => {
    const field = input()
    changed({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, inputTranslation: false } })
    triple(field)
    expect(translate).not.toHaveBeenCalled()
    changed(DEFAULT_CONFIG)
    validate.mockReturnValue(false)
    triple(field)
    expect(translate).not.toHaveBeenCalled()
  })
})
