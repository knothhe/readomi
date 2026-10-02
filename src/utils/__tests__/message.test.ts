import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { onMessage, sendMessage } from "../message"
import { ProviderRequestError } from "../providers/request"
import { attachRequestErrorMeta, getRequestErrorMeta } from "../request/retry-policy"

describe("extension messaging", () => {
  const runtimeId = Object.getOwnPropertyDescriptor(fakeBrowser.runtime, "id")!
  beforeEach(() => {
    fakeBrowser.reset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(fakeBrowser.runtime, "id", runtimeId)
  })

  it("delivers data to the handler and returns its result", async () => {
    const handler = vi.fn(async ({ data }: { data: { tabId: number } }) => data.tabId === 7)
    const off = onMessage("getEnablePageTranslationByTabId", handler)

    await expect(sendMessage("getEnablePageTranslationByTabId", { tabId: 7 })).resolves.toBe(true)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ data: { tabId: 7 } }))
    off()
  })

  it("rethrows a handler error on the sending side", async () => {
    const off = onMessage("getDetectedCode", async () => {
      throw new TypeError("storage is full")
    })

    await expect(sendMessage("getDetectedCode", undefined)).rejects.toMatchObject({ name: "TypeError", message: "storage is full" })
    off()
  })

  it("ignores messages that are not Readomi's and types without a handler", async () => {
    const off = onMessage("refreshDetectedPageLanguage", () => {})
    await expect(fakeBrowser.runtime.sendMessage({ someone: "else" })).resolves.toBeUndefined()
    await expect(fakeBrowser.runtime.sendMessage({ kind: "jiandao-message", type: "refreshDetectedPageLanguage" })).resolves.toBeUndefined()
    await expect(sendMessage("getDetectedCode")).rejects.toThrow(/No handler answered/)
    off()
  })

  it("preserves HTTP status across a JSON reply without forwarding the response body or headers", async () => {
    const off = onMessage("backgroundGenerateText", async () => {
      throw new ProviderRequestError("Missing bearer or basic authentication in header", "https://example.com", 401, { "x-private": "secret" }, "private response")
    })
    const envelope = { kind: "readomi-message", type: "backgroundGenerateText", data: { providerId: "test", prompt: "hello" } }
    const reply = JSON.parse(JSON.stringify(await fakeBrowser.runtime.sendMessage(envelope)))
    expect(reply.error.requestErrorMeta).toEqual({ statusCode: 401 })
    expect(JSON.stringify(reply)).not.toMatch(/secret|private response/)
    const send = vi.spyOn(fakeBrowser.runtime, "sendMessage").mockResolvedValueOnce(reply)
    try {
      await sendMessage("backgroundGenerateText", envelope.data)
      expect.fail("Expected an authentication error")
    }
    catch (error) {
      expect(getRequestErrorMeta(error).statusCode).toBe(401)
    }
    finally {
      send.mockRestore()
      off()
    }
  })

  it("preserves an explicit non-retryable error", async () => {
    const off = onMessage("getDetectedCode", async () => {
      throw attachRequestErrorMeta(new Error("Request rejected"), { isRetryable: false })
    })
    const error = await sendMessage("getDetectedCode").catch(error => error)
    expect(getRequestErrorMeta(error).isRetryable).toBe(false)
    off()
  })

  it("recognizes unload when Chrome closes a port before invalidating the context", async () => {
    vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementationOnce(async () => {
      setTimeout(() => Object.defineProperty(fakeBrowser.runtime, "id", { configurable: true, value: undefined }), 20)
      throw new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received")
    })
    await expect(sendMessage("getDetectedCode")).rejects.toThrow("Extension context invalidated.")
  })

  it("preserves a channel failure when the sending context is still valid", async () => {
    const error = new Error("The message port closed before a response was received")
    vi.spyOn(fakeBrowser.runtime, "sendMessage").mockRejectedValueOnce(error)
    await expect(sendMessage("getDetectedCode")).rejects.toBe(error)
  })

  it.each(["missing receiver", "empty reply"])("recognizes unload when a pending message gets an %s", async (kind) => {
    vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementationOnce(async () => {
      setTimeout(() => Object.defineProperty(fakeBrowser.runtime, "id", { configurable: true, value: undefined }), 20)
      if (kind === "missing receiver")
        throw new Error("Could not establish connection. Receiving end does not exist.")
      return undefined
    })
    await expect(sendMessage("getDetectedCode")).rejects.toThrow("Extension context invalidated.")
  })
})
