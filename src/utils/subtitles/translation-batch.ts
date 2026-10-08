import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { TranslationResult } from "@/utils/host/translate/translation-result"
import type { LanguagePolicyConfig } from "@/utils/language-policy"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { onMessage, sendMessage } from "@/utils/message"

export const SUBTITLE_BATCH_VERSION = "subtitle-ids-context-v1"
export const SUBTITLE_BATCH_ITEMS = 6
export const SUBTITLE_BATCH_CHARACTERS = 1000

export interface SubtitleTranslationItem {
  id: string
  text: string
  before: string[]
  after: string[]
}

export interface SubtitleBatchOutcome {
  id: string
  result?: TranslationResult
  error?: string
  retryable?: boolean
}

export interface SubtitleBatchRequest {
  requestId: string
  items: SubtitleTranslationItem[]
  langConfig: LanguagePolicyConfig
  providerConfig: ProviderConfig
  customPromptsConfig: Config["translate"]["customPromptsConfig"]
  pageUrl: string
  urgent: boolean
}

export type SubtitleBatchProgress = (outcomes: SubtitleBatchOutcome[]) => void
export type TranslateSubtitleBatch = (items: SubtitleTranslationItem[], signal: AbortSignal, urgent: boolean, onProgress: SubtitleBatchProgress) => Promise<SubtitleBatchOutcome[]>

const progressListeners = new Map<string, SubtitleBatchProgress>()
let unsubscribeProgress: (() => void) | undefined

/** A batch is sent as one message, independent of per-cue cache lookup timing. */
export async function translateSubtitleBatch(options: Omit<SubtitleBatchRequest, "requestId">, signal: AbortSignal, onProgress?: SubtitleBatchProgress): Promise<SubtitleBatchOutcome[]> {
  signal.throwIfAborted()
  const requestId = getRandomUUID()
  if (onProgress) {
    progressListeners.set(requestId, (outcomes) => {
      if (!signal.aborted)
        onProgress(outcomes)
    })
    unsubscribeProgress ??= onMessage("subtitleBatchProgress", ({ data }) => progressListeners.get(data.requestId)?.(data.outcomes))
  }
  const cancel = () => void sendMessage("cancelSubtitleBatch", { requestId }).catch(() => {})
  signal.addEventListener("abort", cancel, { once: true })
  try {
    const results = await sendMessage("translateSubtitleBatch", { ...options, requestId })
    signal.throwIfAborted()
    return results
  }
  finally {
    signal.removeEventListener("abort", cancel)
    progressListeners.delete(requestId)
    if (!progressListeners.size) {
      unsubscribeProgress?.()
      unsubscribeProgress = undefined
    }
  }
}
