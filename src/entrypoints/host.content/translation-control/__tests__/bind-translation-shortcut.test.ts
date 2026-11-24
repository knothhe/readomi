// @vitest-environment jsdom
import type { PageTranslationManager } from "../page-translation"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { onMessage, sendMessage } from "@/utils/message"
import { bindTranslationShortcutKey } from "../bind-translation-shortcut"

const { mockGetLocalConfig } = vi.hoisted(() => ({
  mockGetLocalConfig: vi.fn(),
}))

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: mockGetLocalConfig,
  watchLocalConfig: vi.fn(() => vi.fn()),
}))

vi.mock("@/utils/message", () => ({
  onMessage: vi.fn(() => vi.fn()),
  sendMessage: vi.fn(async () => {}),
}))

function createManager(isActive = false): PageTranslationManager {
  return {
    isActive,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  } as unknown as PageTranslationManager
}

function press(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

const cleanups: (() => void)[] = []
async function bind(manager: PageTranslationManager) {
  const cleanup = await bindTranslationShortcutKey(manager)
  cleanups.push(cleanup)
  return cleanup
}
describe("bindTranslationShortcutKey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLocalConfig.mockResolvedValue(DEFAULT_CONFIG)
    document.body.innerHTML = ""
  })
  afterEach(() => cleanups.splice(0).forEach(fn => fn()))

  it("toggles the top manager when a frame shortcut arrives", async () => {
    const manager = createManager()
    await bind(manager)
    const listener = vi.mocked(onMessage).mock.calls.find(([name]) => name === "topPageShortcut")![1]
    await listener({} as never)
    expect(manager.start).toHaveBeenCalledOnce()
  })

  it("only forwards trusted subframe shortcuts", async () => {
    const manager = createManager()
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const target = frame.contentDocument!
    const listen = vi.spyOn(target, "addEventListener")
    vi.stubGlobal("window", frame.contentWindow)
    try {
      cleanups.push(await bindTranslationShortcutKey(manager, target))
      const handler = listen.mock.calls.find(([name]) => name === "keydown")![1] as EventListener
      const key = { key: "e", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      handler({ ...key, isTrusted: false } as unknown as Event)
      expect(sendMessage).not.toHaveBeenCalled()
      handler({ ...key, isTrusted: true } as unknown as Event)
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith("framePageShortcut")
      expect(manager.start).not.toHaveBeenCalled()
    }
    finally {
      vi.unstubAllGlobals()
      listen.mockRestore()
    }
  })

  it("starts translation on the shortcut and swallows the key press", async () => {
    const manager = createManager(false)
    const cleanup = await bind(manager)

    const event = press(document.body, { key: "e", altKey: true })

    expect(manager.start).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)

    cleanup()
    press(document.body, { key: "e", altKey: true })
    expect(manager.start).toHaveBeenCalledTimes(1)
  })

  it("stops translation when it is active", async () => {
    const manager = createManager(true)
    await bind(manager)

    press(document.body, { key: "E", altKey: true })

    expect(manager.stop).toHaveBeenCalledTimes(1)
    expect(manager.start).not.toHaveBeenCalled()
  })

  it("ignores other keys, extra modifiers and presses inside inputs", async () => {
    const manager = createManager(false)
    await bind(manager)
    const input = document.createElement("input")
    document.body.append(input)

    press(document.body, { key: "e" })
    press(document.body, { key: "e", altKey: true, shiftKey: true })
    press(input, { key: "e", altKey: true })

    expect(manager.start).not.toHaveBeenCalled()
  })

  it("does nothing when the shortcut is empty", async () => {
    mockGetLocalConfig.mockResolvedValue({ ...DEFAULT_CONFIG, translate: { ...DEFAULT_CONFIG.translate, page: { shortcut: "" } } })
    const manager = createManager(false)
    const cleanup = await bind(manager)

    press(document.body, { key: "e", altKey: true })

    expect(manager.start).not.toHaveBeenCalled()
    cleanup()
  })

  it("does not bind a shortcut when the context expires during the config read", async () => {
    let finishRead!: (config: typeof DEFAULT_CONFIG) => void
    mockGetLocalConfig.mockReturnValueOnce(new Promise(resolve => finishRead = resolve))
    const manager = createManager(false)
    let invalid = false
    const binding = bindTranslationShortcutKey(manager, document, () => invalid)
    invalid = true
    finishRead(DEFAULT_CONFIG)
    cleanups.push(await binding)
    const event = press(document.body, { key: "e", altKey: true })
    expect(manager.start).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
