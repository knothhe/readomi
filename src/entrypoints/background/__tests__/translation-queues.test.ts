import type { ProviderConfig } from "@/types/config/provider"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

const onMessageMock = vi.fn()
const ensureInitializedConfigMock = vi.fn()
const executeTranslateMock = vi.fn()
const requestTextStreamMock = vi.fn()
const generateArticleSummaryMock = vi.fn()
const articleSummaryCacheGetMock = vi.fn()
const articleSummaryCachePutMock = vi.fn()
const translationCacheGetMock = vi.fn()
const translationCachePutMock = vi.fn()
const logErrorMock = vi.fn()
const logInfoMock = vi.fn()

vi.mock("@/utils/logger", () => ({ logger: { error: logErrorMock, info: logInfoMock, warn: vi.fn() } }))

vi.mock("@/utils/message", () => ({
  onMessage: onMessageMock,
}))

vi.mock("../config", () => ({
  ensureInitializedConfig: ensureInitializedConfigMock,
}))

vi.mock("@/utils/host/translate/execute-translate", () => ({
  executeTranslate: executeTranslateMock,
}))

vi.mock("@/utils/providers/stream", () => ({
  requestTextStream: requestTextStreamMock,
}))

vi.mock("@/utils/content/summary", () => ({
  generateArticleSummary: generateArticleSummaryMock,
}))

vi.mock("@/utils/db/cache-db", () => ({
  cacheDb: {
    articleSummaryCache: {
      get: articleSummaryCacheGetMock,
      put: articleSummaryCachePutMock,
    },
    translationCache: {
      get: translationCacheGetMock,
      put: translationCachePutMock,
    },
  },
}))

function getRegisteredMessageHandler(name: string) {
  const registration = onMessageMock.mock.calls.find(call => call[0] === name)
  if (!registration) {
    throw new Error(`Message handler not registered: ${name}`)
  }
  return registration[1] as (message: { data: Record<string, unknown> }) => Promise<unknown>
}

const llmProvider: ProviderConfig = {
  id: "openai-default",
  name: "OpenAI",
  provider: "openai",
  enabled: true,
  apiKey: "sk-test",
  model: "gpt-5-mini",
}

describe("translation queue helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(browser.runtime.onConnect, "addListener").mockImplementation(() => {})

    ensureInitializedConfigMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      translate: {
        ...DEFAULT_CONFIG.translate,
        enableAIContentAware: true,
      },
    })

    executeTranslateMock.mockResolvedValue("translated text")
    requestTextStreamMock.mockResolvedValue("translated text")
    generateArticleSummaryMock.mockResolvedValue("Generated summary")
    articleSummaryCacheGetMock.mockResolvedValue(undefined)
    articleSummaryCachePutMock.mockResolvedValue(undefined)
    translationCacheGetMock.mockResolvedValue(undefined)
    translationCachePutMock.mockResolvedValue(undefined)
  })

  it("does not cache a translation that drops formula placeholders", async () => {
    executeTranslateMock.mockResolvedValue("公式的译文")
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const result = await handler({ data: {
      text: "The formula {{0}} is useful.", langConfig: DEFAULT_CONFIG.language,
      providerConfig: llmProvider, scheduleAt: Date.now(), hash: "formula-missing",
    } })
    expect(result).toBe("公式的译文")
    expect(translationCachePutMock).not.toHaveBeenCalled()
  })

  it("ignores a cached result with broken placeholders and stores a complete replacement", async () => {
    translationCacheGetMock.mockResolvedValue({ translation: "旧的残缺译文" })
    executeTranslateMock.mockResolvedValue("公式 {{0}} 很有用。")
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await expect(handler({ data: {
      text: "The formula {{0}} is useful.", langConfig: DEFAULT_CONFIG.language,
      providerConfig: llmProvider, scheduleAt: Date.now(), hash: "formula-repaired",
    } })).resolves.toBe("公式 {{0}} 很有用。")
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ key: "formula-repaired", translation: "公式 {{0}} 很有用。" }))
  })

  it("does not cache a streamed translation with duplicated formula placeholders", async () => {
    requestTextStreamMock.mockResolvedValueOnce("公式 {{0}} {{0}}。")
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const port = {
      name: "readomi-hover-translation",
      onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() }, postMessage: vi.fn(),
    }
    const connect = vi.mocked(browser.runtime.onConnect.addListener).mock.calls[0][0]
    connect(port as unknown as Parameters<typeof connect>[0])
    port.onMessage.addListener.mock.calls[0][0]({ text: "The formula {{0}}.", langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, hash: "formula-stream-duplicate" })
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: "done", text: "公式 {{0}} {{0}}。" }))
    expect(translationCachePutMock).not.toHaveBeenCalled()
  })

  it("settles a hover port even if the service returns an empty result", async () => {
    requestTextStreamMock.mockResolvedValueOnce("")
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const port = {
      name: "readomi-hover-translation",
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
    }
    const connect = vi.mocked(browser.runtime.onConnect.addListener).mock.calls[0][0]
    connect(port as unknown as Parameters<typeof connect>[0])
    port.onMessage.addListener.mock.calls[0][0]({
      text: "A paragraph",
      langConfig: DEFAULT_CONFIG.language,
      providerConfig: llmProvider,
      hash: "hover-empty-result",
    })

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: "done", text: "" }))
    expect(requestTextStreamMock).toHaveBeenCalledOnce()
    expect(translationCachePutMock).not.toHaveBeenCalled()
  })

  it("passes webpage context through the translation queue without generating a new summary", async () => {
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    await setUpWebPageTranslationQueue()

    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const result = await handler({
      data: {
        text: "hello",
        langConfig: DEFAULT_CONFIG.language,
        providerConfig: llmProvider,
        scheduleAt: Date.now(),
        hash: "webpage-hash",
        webTitle: "Page title",
        webDescription: "Page description",
        webContent: "Page body",
        webSummary: "Ready summary",
      },
    })

    expect(result).toBe("translated text")
    expect(generateArticleSummaryMock).not.toHaveBeenCalled()
    expect(executeTranslateMock).toHaveBeenCalledWith(
      "hello",
      DEFAULT_CONFIG.language,
      llmProvider,
      expect.any(Function),
      expect.objectContaining({
        context: {
          webTitle: "Page title",
          webDescription: "Page description",
          webContent: "Page body",
          webSummary: "Ready summary",
        },
      }),
    )
  })

  it("returns cached translations unchanged", async () => {
    translationCacheGetMock.mockResolvedValueOnce({
      key: "webpage-hash",
      translation: "L&#39;Iran chiama &quot;Dichiarazione&quot; &lt;span&gt;",
    })

    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    await setUpWebPageTranslationQueue()

    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const result = await handler({
      data: {
        text: "hello",
        langConfig: DEFAULT_CONFIG.language,
        providerConfig: llmProvider,
        scheduleAt: Date.now(),
        hash: "webpage-hash",
      },
    })

    expect(result).toBe("L&#39;Iran chiama &quot;Dichiarazione&quot; &lt;span&gt;")
    expect(executeTranslateMock).not.toHaveBeenCalled()
    expect(translationCachePutMock).not.toHaveBeenCalled()
  })

  it("exposes webpage summary generation as a separate background handler", async () => {
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    await setUpWebPageTranslationQueue()

    const handler = getRegisteredMessageHandler("getOrGenerateWebPageSummary")
    const result = await handler({
      data: {
        webTitle: "Page title",
        webContent: "page body",
        providerConfig: llmProvider,
      },
    })

    expect(result).toBe("Generated summary")
    expect(generateArticleSummaryMock).toHaveBeenCalledWith(
      "Page title",
      "page body",
      llmProvider,
    )
  })

  it("recovers missing batch translations in order without reporting a failed request", async () => {
    executeTranslateMock.mockImplementation(async (text: string) => text.includes("\n%%\n") ? "incomplete response" : `translated-${text}`)
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const texts = ["First paragraph", "Second paragraph", "Third paragraph", "Fourth paragraph"]
    const results = await Promise.all(texts.map(text => handler({ data: {
      text,
      langConfig: DEFAULT_CONFIG.language,
      providerConfig: { ...llmProvider, id: "partial-batch-provider" },
      scheduleAt: Date.now(),
      hash: `partial-${text}`,
    } })))
    expect(results).toEqual(texts.map(text => `translated-${text}`))
    expect(logInfoMock).toHaveBeenCalledWith("Batch response could not be aligned; retrying smaller requests", expect.any(Object))
    expect(logErrorMock).not.toHaveBeenCalled()
    for (const text of texts)
      expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ key: `partial-${text}`, translation: `translated-${text}` }))
  })

  it("still reports a terminal service failure", async () => {
    executeTranslateMock.mockRejectedValue(new Error("Invalid API key"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await expect(handler({ data: {
      text: "A paragraph",
      langConfig: DEFAULT_CONFIG.language,
      providerConfig: { ...llmProvider, id: "failing-provider" },
      scheduleAt: Date.now(),
      hash: "failing-request",
    } })).rejects.toThrow("Invalid API key")
    expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("Batch request failed"), "Invalid API key")
    expect(translationCachePutMock).not.toHaveBeenCalled()
  })
})
