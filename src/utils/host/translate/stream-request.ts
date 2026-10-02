import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { WebPagePromptContext } from "@/types/content"
import { browser } from "#imports"

export const HOVER_STREAM_PORT = "readomi-hover-translation"
export interface HoverStreamRequest {
  text: string
  langConfig: Config["language"]
  providerConfig: ProviderConfig
  hash: string
  context?: WebPagePromptContext
}
export type HoverStreamReply
  = | { type: "partial", text: string }
    | { type: "done", text: string }
    | { type: "error", message: string }

/** Request override used by the paragraph renderer, with its loading state. */
export type PageTranslationRequest = ((text: string) => Promise<string>) & { showSpinner?: boolean }

export interface PageTranslationRequestOptions {
  onPartial?: (text: string) => void
  signal?: AbortSignal
}

export function requestHoverStream(data: HoverStreamRequest, options: PageTranslationRequestOptions): Promise<string> {
  options.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: HOVER_STREAM_PORT })
    function cleanup() {
      options.signal?.removeEventListener("abort", abort)
      port.onMessage.removeListener(message)
      port.onDisconnect.removeListener(disconnect)
      port.disconnect()
    }
    function abort() {
      cleanup()
      reject(new DOMException("Translation cancelled", "AbortError"))
    }
    function disconnect() {
      // Read lastError so Chrome does not emit an unchecked runtime error.
      const error = browser.runtime.lastError
      cleanup()
      reject(new Error(error?.message ?? "Translation connection closed"))
    }
    function message(reply: HoverStreamReply) {
      if (options.signal?.aborted)
        return
      if (reply.type === "partial") {
        options.onPartial?.(reply.text)
      }
      else {
        cleanup()
        if (reply.type === "done")
          resolve(reply.text)
        else
          reject(new Error(reply.message))
      }
    }
    port.onMessage.addListener(message)
    port.onDisconnect.addListener(disconnect)
    options.signal?.addEventListener("abort", abort, { once: true })
    try {
      port.postMessage(data)
    }
    catch (error) {
      cleanup()
      reject(error)
    }
  })
}
