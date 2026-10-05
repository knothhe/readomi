import type { TranslationResult } from "./translation-result"
import type { LangCodeISO6393 } from "@/definitions"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { WebPagePromptContext } from "@/types/content"
import type { LanguagePolicyConfig } from "@/utils/language-policy"
import { browser } from "#imports"
import { displayTranslationResult } from "./translation-result"

export const HOVER_STREAM_PORT = "readomi-hover-translation"
export interface HoverStreamRequest {
  text: string
  langConfig: LanguagePolicyConfig
  providerConfig: ProviderConfig
  hash: string
  pageUrl?: string
  context?: WebPagePromptContext
  customPromptsConfig?: Config["translate"]["customPromptsConfig"]
}
export type HoverStreamReply
  = | { type: "partial", text: string }
    | { type: "target", targetCode: LangCodeISO6393 }
    | { type: "done", result: TranslationResult }
    | { type: "error", message: string, name?: string }

/**
 * Typography comes from the final text container. Streaming renderers call
 * hideSpinner when the first text becomes visible, before the request finishes.
 */
export type PageTranslationRequest = ((text: string, typographyElement?: HTMLElement, hideSpinner?: () => void, onTargetLanguage?: (targetCode: LangCodeISO6393) => void) => Promise<string>) & {
  showSpinner?: boolean
  /** A source group can invalidate the owning hover session and its network request. */
  cancel?: () => void
}

export interface PageTranslationRequestOptions {
  onPartial?: (text: string) => void
  onTargetLanguage?: (targetCode: LangCodeISO6393) => void
  customPromptsConfig?: Config["translate"]["customPromptsConfig"]
  signal?: AbortSignal
}

export function requestHoverStream(data: HoverStreamRequest, options: PageTranslationRequestOptions): Promise<string> {
  options.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: HOVER_STREAM_PORT })
    let reportedTarget: LangCodeISO6393 | undefined
    const reportTarget = (targetCode: LangCodeISO6393) => {
      if (reportedTarget !== targetCode) {
        reportedTarget = targetCode
        options.onTargetLanguage?.(targetCode)
      }
    }
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
      else if (reply.type === "target") {
        reportTarget(reply.targetCode)
      }
      else {
        cleanup()
        if (reply.type === "done") {
          if (reply.result.targetCode)
            reportTarget(reply.result.targetCode)
          resolve(displayTranslationResult(reply.result))
        }
        else {
          const error = new Error(reply.message)
          error.name = reply.name ?? "Error"
          reject(error)
        }
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
