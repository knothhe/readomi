import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { WebPagePromptContext } from "@/types/content"
import type { PromptResolver } from "@/utils/host/translate/api/ai"
import type { HoverStreamReply, HoverStreamRequest } from "@/utils/host/translate/stream-request"
import { browser } from "#imports"
import { LANG_CODE_TO_EN_NAME } from "@/definitions"
import { BATCH_SEPARATOR, BATCH_SEPARATOR_LINE_PATTERN } from "@/utils/constants/prompt"
import { DEFAULT_MAX_CHARACTER_PER_BATCH, DEFAULT_MAX_ITEMS_PER_BATCH, INITIAL_REQUEST_RATE, MAX_REQUEST_RATE, MIN_REQUEST_RATE, REQUEST_BURST_SECONDS } from "@/utils/constants/translate"
import { generateArticleSummary } from "@/utils/content/summary"
import { cleanText } from "@/utils/content/utils"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { cacheDb } from "@/utils/db/cache-db"
import { sha256Hex, stringHash } from "@/utils/hash"
import { executeTranslate } from "@/utils/host/translate/execute-translate"
import { auditInlineAtomTokens, hasInlineAtomTokens } from "@/utils/host/translate/inline-atom-tokens"
import { HOVER_STREAM_PORT } from "@/utils/host/translate/stream-request"
import { normalizePromptContextValue } from "@/utils/host/translate/translate-text"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { getTranslatePrompt } from "@/utils/prompts/translate"
import { requestTextStream } from "@/utils/providers/stream"
import { BatchQueue } from "@/utils/request/batch-queue"
import { Pace } from "@/utils/request/pace"
import { RequestQueue } from "@/utils/request/request-queue"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { serviceLimitsKey, ServiceLimitsStore } from "@/utils/request/service-limits"

export function parseBatchResult(result: string): string[] {
  return result.trim().split(BATCH_SEPARATOR_LINE_PATTERN).map(t => t.trim())
}

function hasIntactInlineAtoms(source: string, translated: string): boolean {
  return !hasInlineAtomTokens(source) || auditInlineAtomTokens(source, translated).ok
}

export async function executeBatchTranslation<TContext>(
  dataList: TranslateBatchData<TContext>[],
  promptResolver: PromptResolver<TContext>,
): Promise<string[]> {
  const { langConfig, providerConfig, context } = dataList[0]
  const texts = dataList.map(d => d.text)

  const batchText = texts.join(`\n\n${BATCH_SEPARATOR}\n\n`)
  const result = await executeTranslate(batchText, langConfig, providerConfig, promptResolver, { isBatch: true, context })
  return parseBatchResult(result)
}

async function getOrGenerateWebPageSummary(
  webTitle: string,
  webContent: string,
  providerConfig: ProviderConfig,
  requestQueue: RequestQueue,
): Promise<string | null> {
  const preparedText = cleanText(webContent)
  if (!preparedText) {
    return null
  }

  const textHash = await sha256Hex(preparedText)
  const cacheKey = await sha256Hex(webTitle, textHash, JSON.stringify(providerConfig))

  const cached = await cacheDb.articleSummaryCache.get(cacheKey)
  if (cached) {
    logger.info("Using cached summary")
    return cached.summary
  }

  const thunk = async () => {
    const cachedAgain = await cacheDb.articleSummaryCache.get(cacheKey)
    if (cachedAgain) {
      return cachedAgain.summary
    }

    const summary = await generateArticleSummary(webTitle, webContent, providerConfig)
    if (!summary) {
      return ""
    }

    await cacheDb.articleSummaryCache.put({
      key: cacheKey,
      summary,
      createdAt: new Date(),
    })

    logger.info("Generated and cached new summary")
    return summary
  }

  try {
    const summary = await requestQueue.enqueue(thunk, Date.now(), cacheKey)
    return summary || null
  }
  catch (error) {
    logger.warn("Failed to get/generate summary:", error)
    return null
  }
}

export interface TranslateBatchData<TContext = unknown> {
  text: string
  langConfig: Config["language"]
  providerConfig: ProviderConfig
  hash: string
  scheduleAt: number
  context?: TContext
}

/**
 * One request queue per service and model, each with the pace that service
 * tolerates. The pace and the batch sizes a service handles are learned while
 * translating and kept in `limits`, so the next session starts from them
 * instead of probing again (design/Adaptive.html).
 */
function createTranslationQueues<TContext>(promptResolver: PromptResolver<TContext>, limits: ServiceLimitsStore) {
  const requestQueues = new Map<string, RequestQueue>()

  const requestQueueFor = (providerConfig: ProviderConfig): RequestQueue => {
    const key = serviceLimitsKey(providerConfig)
    let queue = requestQueues.get(key)
    if (!queue) {
      const pace = new Pace(
        { minRate: MIN_REQUEST_RATE, maxRate: MAX_REQUEST_RATE, burstSeconds: REQUEST_BURST_SECONDS },
        limits.get(key)?.pace ?? { rate: INITIAL_REQUEST_RATE, ceiling: null },
        state => limits.update(key, { pace: state }),
      )
      queue = new RequestQueue({
        rate: pace.rate,
        capacity: pace.capacity,
        timeoutMs: 20_000,
        maxRetries: 2,
        baseRetryDelayMs: 1_000,
        pace,
      })
      requestQueues.set(key, queue)
    }
    return queue
  }

  const batchQueue = new BatchQueue<TranslateBatchData<TContext>, string>({
    maxCharactersPerBatch: DEFAULT_MAX_CHARACTER_PER_BATCH,
    maxItemsPerBatch: DEFAULT_MAX_ITEMS_PER_BATCH,
    batchDelay: 100,
    enableFallbackToIndividual: true,
    getBatchKey: (data) => {
      return stringHash(
        `${data.langConfig.sourceCode}-${data.langConfig.targetCode}-${data.providerConfig.id}`,
        data.context ? JSON.stringify(data.context) : "",
      )
    },
    // Batch sizes a service has shown it cannot handle stay small for that service, across sessions.
    getLimitKey: data => serviceLimitsKey(data.providerConfig),
    learnedLimits: key => limits.get(key)?.batch,
    onLimitsLearned: (key, batch) => limits.update(key, { batch }),
    getCharacters: data => data.text.length,
    executeBatch: async (dataList) => {
      const hash = await sha256Hex(...dataList.map(d => d.hash))
      const earliestScheduleAt = Math.min(...dataList.map(d => d.scheduleAt))

      const batchThunk = async (): Promise<string[]> => {
        return await executeBatchTranslation(dataList, promptResolver)
      }

      return requestQueueFor(dataList[0].providerConfig).enqueue(batchThunk, earliestScheduleAt, hash)
    },
    executeIndividual: async (data) => {
      const { text, langConfig, providerConfig, hash, scheduleAt, context } = data
      const thunk = async () => {
        return executeTranslate(text, langConfig, providerConfig, promptResolver, { context })
      }
      return requestQueueFor(providerConfig).enqueue(thunk, scheduleAt, hash)
    },
    onError: (error, context) => {
      if (context.willRetry) {
        logger.info("Batch response could not be aligned; retrying smaller requests", { batchKey: context.batchKey, retryCount: context.retryCount })
        return
      }
      const errorType = context.isFallback ? "Individual request" : "Batch request"
      logger.error(
        `${errorType} failed (batchKey: ${context.batchKey}, retry: ${context.retryCount}):`,
        error.message,
      )
    },
  })

  return { requestQueueFor, batchQueue }
}

export function setUpWebPageTranslationQueue() {
  const limits = new ServiceLimitsStore()
  const { requestQueueFor, batchQueue } = createTranslationQueues(getTranslatePrompt, limits)

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== HOVER_STREAM_PORT)
      return
    const controller = new AbortController()
    let started = false
    port.onDisconnect.addListener(() => controller.abort())
    const reply = (message: HoverStreamReply) => {
      if (!controller.signal.aborted)
        port.postMessage(message)
    }
    port.onMessage.addListener((data: HoverStreamRequest) => {
      if (started || controller.signal.aborted)
        return
      started = true
      void (async () => {
        try {
          const cached = await cacheDb.translationCache.get(data.hash)
          controller.signal.throwIfAborted()
          if (cached && hasIntactInlineAtoms(data.text, cached.translation)) {
            reply({ type: "done", text: cached.translation })
            return
          }
          await limits.load()
          const result = await requestQueueFor(data.providerConfig).enqueue(async () => {
            if (controller.signal.aborted)
              throw attachRequestErrorMeta(new DOMException("Translation cancelled", "AbortError"), { isRetryable: false })
            // Each attempt has its own deadline, so a timed-out fetch cannot
            // continue sending partials while the queue starts a retry.
            const attempt = new AbortController()
            const timeout = setTimeout(() => attempt.abort(), 110_000)
            try {
              reply({ type: "partial", text: "" })
              const { systemPrompt, prompt } = await getTranslatePrompt(LANG_CODE_TO_EN_NAME[data.langConfig.targetCode], data.text, { context: data.context })
              return await requestTextStream(data.providerConfig, {
                system: systemPrompt,
                prompt,
                temperature: data.providerConfig.temperature,
              }, text => reply({ type: "partial", text }), AbortSignal.any([controller.signal, attempt.signal]))
            }
            finally {
              clearTimeout(timeout)
            }
          }, Date.now(), `hover:${data.hash}:${getRandomUUID()}`, 120_000)
          controller.signal.throwIfAborted()
          if (result && hasIntactInlineAtoms(data.text, result)) {
            await cacheDb.translationCache.put({ key: data.hash, translation: result, createdAt: new Date() })
          }
          reply({ type: "done", text: result })
        }
        catch (error) {
          reply({ type: "error", message: error instanceof Error ? error.message : String(error) })
        }
      })()
    })
  })

  onMessage("enqueueTranslateRequest", async (message) => {
    const { data: { text, langConfig, providerConfig, scheduleAt, hash, webTitle, webDescription, webContent, webSummary } } = message

    // Check cache first
    if (hash) {
      const cached = await cacheDb.translationCache.get(hash)
      if (cached && hasIntactInlineAtoms(text, cached.translation)) {
        return cached.translation
      }
    }

    let result = ""
    const context: WebPagePromptContext = {
      webTitle: normalizePromptContextValue(webTitle),
      webDescription: normalizePromptContextValue(webDescription),
      webContent: normalizePromptContextValue(webContent),
      webSummary: normalizePromptContextValue(webSummary),
    }

    // Learned limits decide the first batch size and pace, so they must be read before the first request.
    await limits.load()
    const data = { text, langConfig, providerConfig, hash, scheduleAt, context }
    result = await batchQueue.enqueue(data)

    // Cache the translation result if successful
    if (result && hash && hasIntactInlineAtoms(text, result)) {
      await cacheDb.translationCache.put({
        key: hash,
        translation: result,
        createdAt: new Date(),
      })
    }

    return result
  })

  onMessage("getOrGenerateWebPageSummary", async (message) => {
    const { webTitle, webContent, providerConfig } = message.data

    if (!webTitle || !webContent) {
      return null
    }

    await limits.load()
    return await getOrGenerateWebPageSummary(webTitle, webContent, providerConfig, requestQueueFor(providerConfig))
  })
}
