import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { translateTextCore } from "../translate-text"

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }))
vi.mock("@/utils/message", () => ({ sendMessage: mocks.sendMessage }))

const options = {
  text: "中文原文",
  langConfig: DEFAULT_CONFIG.language,
  providerConfig: DEFAULT_CONFIG.providersConfig[0],
  customPromptsConfig: DEFAULT_CONFIG.translate.customPromptsConfig,
}

describe("translation results at the string boundary", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it("enqueues translation on HTTP pages without Web Crypto using the same cache key", async () => {
    mocks.sendMessage.mockResolvedValue({ action: "translate", text: "English translation", targetCode: "eng" })
    await translateTextCore(options)
    const secureRequest = mocks.sendMessage.mock.calls[0][1]
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) })

    await expect(translateTextCore(options)).resolves.toBe("English translation")
    expect(mocks.sendMessage).toHaveBeenLastCalledWith("enqueueTranslateRequest", expect.objectContaining({
      text: secureRequest.text,
      hash: secureRequest.hash,
    }))
  })

  it("reports the actual target while retaining the string result API", async () => {
    mocks.sendMessage.mockResolvedValueOnce({ action: "translate", text: "English translation", targetCode: "eng" })
    const onTargetLanguage = vi.fn()
    await expect(translateTextCore({ ...options, onTargetLanguage })).resolves.toBe("English translation")
    expect(onTargetLanguage).toHaveBeenCalledWith("eng")
    expect(mocks.sendMessage).toHaveBeenCalledWith("enqueueTranslateRequest", expect.objectContaining({ customPromptsConfig: options.customPromptsConfig }))
  })

  it("maps preservation to the renderer's empty string without changing original language attributes", async () => {
    mocks.sendMessage.mockResolvedValueOnce({ action: "preserve", text: "" })
    const onTargetLanguage = vi.fn()
    await expect(translateTextCore({ ...options, onTargetLanguage })).resolves.toBe("")
    expect(onTargetLanguage).not.toHaveBeenCalled()
  })

  it("does not enqueue already cancelled translations", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(translateTextCore({ ...options, signal: controller.signal })).rejects.toThrow()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("suppresses both target metadata and text when cancelled while the background finishes", async () => {
    let resolve!: (value: unknown) => void
    mocks.sendMessage.mockImplementationOnce(() => new Promise(done => resolve = done))
    const controller = new AbortController()
    const onTargetLanguage = vi.fn()
    const pending = translateTextCore({ ...options, signal: controller.signal, onTargetLanguage })
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce())
    controller.abort()
    resolve({ action: "translate", text: "Stale text", targetCode: "eng" })
    await expect(pending).rejects.toThrow()
    expect(onTargetLanguage).not.toHaveBeenCalled()
  })
})
