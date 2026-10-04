import type { HoverStreamReply } from "../stream-request"
import { afterEach, describe, expect, it, vi } from "vitest"
import { browser } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { requestHoverStream } from "../stream-request"

function connectPort() {
  const listeners = new Set<(reply: HoverStreamReply) => void>()
  const port = {
    onMessage: { addListener: (listener: (reply: HoverStreamReply) => void) => listeners.add(listener), removeListener: (listener: (reply: HoverStreamReply) => void) => listeners.delete(listener) },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    postMessage: vi.fn(), disconnect: vi.fn(),
  }
  vi.spyOn(browser.runtime, "connect").mockReturnValue(port as unknown as ReturnType<typeof browser.runtime.connect>)
  return { port, emit: (reply: HoverStreamReply) => listeners.forEach(listener => listener(reply)) }
}

const request = { text: "中文原文", langConfig: DEFAULT_CONFIG.language, providerConfig: DEFAULT_CONFIG.providersConfig[0], hash: "stream" }

describe("hover stream string boundary", () => {
  afterEach(() => vi.restoreAllMocks())

  it("delivers target metadata before text and reports the target once", async () => {
    const { port, emit } = connectPort()
    const events: string[] = []
    const pending = requestHoverStream(request, { onTargetLanguage: code => events.push(`target:${code}`), onPartial: text => events.push(`text:${text}`) })
    emit({ type: "target", targetCode: "eng" })
    emit({ type: "partial", text: "English" })
    emit({ type: "done", result: { action: "translate", text: "English", targetCode: "eng" } })
    await expect(pending).resolves.toBe("English")
    expect(events).toEqual(["target:eng", "text:English"])
    expect(port.disconnect).toHaveBeenCalledOnce()
  })

  it("returns an empty string for preservation without rendering a duplicate source", async () => {
    const { emit } = connectPort()
    const onPartial = vi.fn()
    const onTargetLanguage = vi.fn()
    const pending = requestHoverStream(request, { onPartial, onTargetLanguage })
    emit({ type: "done", result: { action: "preserve", text: "" } })
    await expect(pending).resolves.toBe("")
    expect(onPartial).not.toHaveBeenCalled()
    expect(onTargetLanguage).not.toHaveBeenCalled()
  })

  it("ignores all late replies after cancellation", async () => {
    const { emit } = connectPort()
    const controller = new AbortController()
    const onPartial = vi.fn()
    const onTargetLanguage = vi.fn()
    const pending = requestHoverStream(request, { signal: controller.signal, onPartial, onTargetLanguage })
    controller.abort()
    emit({ type: "target", targetCode: "eng" })
    emit({ type: "partial", text: "Stale text" })
    emit({ type: "done", result: { action: "translate", text: "Stale text", targetCode: "eng" } })
    await expect(pending).rejects.toThrow()
    expect(onPartial).not.toHaveBeenCalled()
    expect(onTargetLanguage).not.toHaveBeenCalled()
  })

  it("preserves the quality error name across the hover port for localized failure copy", async () => {
    const { emit } = connectPort()
    const pending = requestHoverStream(request, {})
    emit({ type: "error", name: "TranslationQualityError", message: "The translation response selected the wrong language direction" })
    await expect(pending).rejects.toMatchObject({ name: "TranslationQualityError" })
  })
})
