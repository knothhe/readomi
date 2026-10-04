import type { ProviderConfig } from "@/types/config/provider"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { TRANSLATION_PROTOCOL_VERSION } from "@/utils/host/translate/translation-result"

const onMessageMock = vi.fn()
const ensureInitializedConfigMock = vi.fn()
const executeTranslateMock = vi.fn()
const requestTextStreamMock = vi.fn()
const generateArticleSummaryMock = vi.fn()
const articleSummaryCacheGetMock = vi.fn()
const articleSummaryCachePutMock = vi.fn()
const translationCacheGetMock = vi.fn()
const translationCachePutMock = vi.fn()
const translationCacheDeleteMock = vi.fn()
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
      delete: translationCacheDeleteMock,
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

function response(text: string, route = "primary") {
  return `[[readomi:${route}]]\n${text}`
}

function translated(text: string, targetCode = "cmn") {
  return { action: "translate", text, targetCode }
}

describe("translation queue helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.spyOn(browser.runtime.onConnect, "addListener").mockImplementation(() => {})

    ensureInitializedConfigMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      translate: {
        ...DEFAULT_CONFIG.translate,
        enableAIContentAware: true,
      },
    })

    executeTranslateMock.mockResolvedValue(response("translated text"))
    requestTextStreamMock.mockResolvedValue(response("translated text"))
    generateArticleSummaryMock.mockResolvedValue("Generated summary")
    articleSummaryCacheGetMock.mockResolvedValue(undefined)
    articleSummaryCachePutMock.mockResolvedValue(undefined)
    translationCacheGetMock.mockResolvedValue(undefined)
    translationCachePutMock.mockResolvedValue(undefined)
    translationCacheDeleteMock.mockResolvedValue(undefined)
  })

  it("does not cache a translation that drops formula placeholders", async () => {
    executeTranslateMock.mockResolvedValue(response("公式的译文"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const result = await handler({ data: {
      text: "The formula {{0}} is useful.", langConfig: DEFAULT_CONFIG.language,
      providerConfig: llmProvider, scheduleAt: Date.now(), hash: "formula-missing",
    } })
    expect(result).toEqual(translated("公式的译文"))
    expect(translationCachePutMock).not.toHaveBeenCalled()
  })

  it("ignores a cached result with broken placeholders and stores a complete replacement", async () => {
    translationCacheGetMock.mockResolvedValue({ translation: "旧的残缺译文" })
    executeTranslateMock.mockResolvedValue(response("公式 {{0}} 很有用。"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await expect(handler({ data: {
      text: "The formula {{0}} is useful.", langConfig: DEFAULT_CONFIG.language,
      providerConfig: llmProvider, scheduleAt: Date.now(), hash: "formula-repaired",
    } })).resolves.toEqual(translated("公式 {{0}} 很有用。"))
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ key: "formula-repaired", translation: "公式 {{0}} 很有用。" }))
  })

  it("does not cache a streamed translation with duplicated formula placeholders", async () => {
    requestTextStreamMock.mockResolvedValueOnce(response("公式 {{0}} {{0}}。"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const port = {
      name: "readomi-hover-translation",
      onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() }, postMessage: vi.fn(),
    }
    const connect = vi.mocked(browser.runtime.onConnect.addListener).mock.calls[0][0]
    connect(port as unknown as Parameters<typeof connect>[0])
    port.onMessage.addListener.mock.calls[0][0]({ text: "The formula {{0}}.", langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, hash: "formula-stream-duplicate" })
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: "done", result: translated("公式 {{0}} {{0}}。") }))
    expect(translationCachePutMock).not.toHaveBeenCalled()
  })

  it("settles a hover port and caches the preserve result without repeating the original", async () => {
    requestTextStreamMock.mockResolvedValueOnce("[[readomi:preserve]]")
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
      langConfig: { ...DEFAULT_CONFIG.language, secondaryCode: "original" },
      providerConfig: llmProvider,
      hash: "hover-empty-result",
    })

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: "done", result: { action: "preserve", text: "" } }))
    expect(requestTextStreamMock).toHaveBeenCalledOnce()
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ action: "preserve", translation: "" }))
  })

  it("sends the actual target before streamed text and hides a split protocol header", async () => {
    requestTextStreamMock.mockImplementationOnce(async (_provider, _request, onPartial) => {
      onPartial("[[readomi:sec")
      onPartial("[[readomi:secondary]]\nEnglish")
      return response("English translation", "secondary")
    })
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const port = {
      name: "readomi-hover-translation",
      onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() }, postMessage: vi.fn(),
    }
    const connect = vi.mocked(browser.runtime.onConnect.addListener).mock.calls[0][0]
    connect(port as unknown as Parameters<typeof connect>[0])
    port.onMessage.addListener.mock.calls[0][0]({ text: "中文段落", langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, hash: "stream-secondary" })
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: "done", result: translated("English translation", "eng") }))
    const messages = port.postMessage.mock.calls.map(([message]) => message)
    expect(messages).toEqual([
      { type: "partial", text: "" },
      { type: "target", targetCode: "eng" },
      { type: "partial", text: "English" },
      { type: "done", result: translated("English translation", "eng") },
    ])
  })

  it("keeps mixed-language batch results aligned when the middle paragraph is preserved", async () => {
    executeTranslateMock.mockResolvedValueOnce(`${response("中文译文")}\n\n%%\n\n[[readomi:preserve]]\n\n%%\n\n${response("另一个译文")}`)
    const { executeBatchTranslation } = await import("../translation-queues")
    const customPromptsConfig = { promptId: "tone", patterns: [{ id: "tone", name: "Tone", systemPrompt: "Use precise terms", prompt: "{{input}}" }] }
    const data = ["English paragraph", "中文原文", "日本語の段落"].map((text, index) => ({
      text, langConfig: { ...DEFAULT_CONFIG.language, secondaryCode: "original" as const }, providerConfig: llmProvider,
      hash: `mixed-${index}`, scheduleAt: Date.now(), customPromptsConfig,
    }))
    const promptResolver = vi.fn()
    await expect(executeBatchTranslation(data, promptResolver)).resolves.toEqual([
      translated("中文译文"), { action: "preserve", text: "" }, translated("另一个译文"),
    ])
    expect(executeTranslateMock).toHaveBeenCalledWith(expect.stringContaining("English paragraph\n\n%%\n\n中文原文"), data[0].langConfig, llmProvider, promptResolver, expect.objectContaining({ customPromptsConfig }))
  })

  it("reuses a cached preserved paragraph without losing its empty result", async () => {
    translationCacheGetMock.mockResolvedValueOnce({ action: "preserve", translation: "", protocolVersion: TRANSLATION_PROTOCOL_VERSION })
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await expect(handler({ data: {
      text: "保留链接和原文", langConfig: { ...DEFAULT_CONFIG.language, secondaryCode: "original" },
      providerConfig: llmProvider, scheduleAt: Date.now(), hash: "cached-original",
    } })).resolves.toEqual({ action: "preserve", text: "" })
    expect(executeTranslateMock).not.toHaveBeenCalled()
  })

  it("retries a missing language header instead of interpreting it as preserved text", async () => {
    executeTranslateMock.mockResolvedValueOnce("An unmarked translation").mockResolvedValueOnce(response("正确译文"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await expect(handler({ data: {
      text: "A paragraph", langConfig: DEFAULT_CONFIG.language,
      providerConfig: { ...llmProvider, id: "protocol-retry" }, scheduleAt: Date.now(), hash: "protocol-retry",
    } })).resolves.toEqual(translated("正确译文"))
    expect(executeTranslateMock).toHaveBeenCalledTimes(2)
    expect(translationCachePutMock).toHaveBeenCalledTimes(1)
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

    expect(result).toEqual(translated("translated text"))
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
      translation: "你好 &lt;span&gt;",
      targetCode: "cmn",
      protocolVersion: TRANSLATION_PROTOCOL_VERSION,
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

    expect(result).toEqual(translated("你好 &lt;span&gt;"))
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
    executeTranslateMock.mockImplementation(async (text: string) => text.includes("\n%%\n") ? response("incomplete response") : response(`translated-${text}`))
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
    expect(results).toEqual(texts.map(text => translated(`translated-${text}`)))
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

  it("retires legacy cache entries and stores only the current protocol", async () => {
    translationCacheGetMock.mockResolvedValueOnce({ translation: "旧译文", targetCode: "cmn", protocolVersion: "automatic-language-v1" })
    executeTranslateMock.mockResolvedValueOnce(response("保持代码、标识符、专有名词和行内格式不变。"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await handler({ data: {
      text: "Keep code, identifiers, proper nouns and inline formatting as they are.",
      langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, scheduleAt: Date.now(), hash: "legacy-quality",
    } })
    expect(translationCacheDeleteMock).toHaveBeenCalledWith("legacy-quality")
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ protocolVersion: TRANSLATION_PROTOCOL_VERSION }))
  })

  it("audits current cache hits instead of reusing a wrong direction", async () => {
    const text = "Keep code, identifiers, proper nouns and inline formatting as they are."
    translationCacheGetMock.mockResolvedValueOnce({ translation: text, targetCode: "eng", protocolVersion: TRANSLATION_PROTOCOL_VERSION })
    executeTranslateMock.mockResolvedValueOnce(response("保持代码、标识符、专有名词和行内格式不变。"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await expect(handler({ data: { text, langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, scheduleAt: Date.now(), hash: "wrong-direction" } })).resolves.toEqual(translated("保持代码、标识符、专有名词和行内格式不变。"))
    expect(translationCacheDeleteMock).toHaveBeenCalledWith("wrong-direction")
    expect(executeTranslateMock).toHaveBeenCalledOnce()
  })

  it("retries rejected translations with correction rules before caching the replacement", async () => {
    vi.useFakeTimers()
    try {
      const text = "Keep code, identifiers, proper nouns and inline formatting as they are."
      executeTranslateMock.mockResolvedValueOnce(response(text, "secondary")).mockResolvedValueOnce(response("保持代码、标识符、专有名词和行内格式不变。"))
      const { setUpWebPageTranslationQueue } = await import("../translation-queues")
      setUpWebPageTranslationQueue()
      const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
      const pending = handler({ data: { text, langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, scheduleAt: Date.now(), hash: "quality-recovery" } })
      await vi.waitFor(() => expect(executeTranslateMock).toHaveBeenCalledOnce())
      await vi.runAllTimersAsync()
      await expect(pending).resolves.toEqual(translated("保持代码、标识符、专有名词和行内格式不变。"))
      expect(executeTranslateMock).toHaveBeenCalledTimes(2)
      expect(executeTranslateMock.mock.calls.map(call => call[4].qualityRetry)).toEqual([false, true])
      expect(translationCachePutMock).toHaveBeenCalledOnce()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it("stops after two quality retries and never caches a rejected result", async () => {
    vi.useFakeTimers()
    try {
      const text = "Keep code, identifiers, proper nouns and inline formatting as they are."
      executeTranslateMock.mockResolvedValue(response(text, "secondary"))
      const { setUpWebPageTranslationQueue } = await import("../translation-queues")
      setUpWebPageTranslationQueue()
      const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
      const pending = expect(handler({ data: { text, langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, scheduleAt: Date.now(), hash: "quality-terminal" } })).rejects.toMatchObject({ name: "TranslationQualityError" })
      await vi.waitFor(() => expect(executeTranslateMock).toHaveBeenCalledOnce())
      await vi.runAllTimersAsync()
      await pending
      expect(executeTranslateMock).toHaveBeenCalledTimes(3)
      expect(translationCachePutMock).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it("suppresses a known wrong streamed route and repairs it without caching the failed attempt", async () => {
    vi.useFakeTimers()
    try {
      const text = "Keep code, identifiers, proper nouns and inline formatting as they are."
      requestTextStreamMock.mockImplementationOnce(async (_provider, _request, partial) => {
        partial(response(text, "secondary"))
        return response(text, "secondary")
      }).mockImplementationOnce(async (_provider, _request, partial) => {
        partial(response("保持代码、标识符、专有名词和行内格式不变。"))
        return response("保持代码、标识符、专有名词和行内格式不变。")
      })
      const { setUpWebPageTranslationQueue } = await import("../translation-queues")
      setUpWebPageTranslationQueue()
      const port = { name: "readomi-hover-translation", onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() }, postMessage: vi.fn() }
      const connect = vi.mocked(browser.runtime.onConnect.addListener).mock.calls[0][0]
      connect(port as unknown as Parameters<typeof connect>[0])
      port.onMessage.addListener.mock.calls[0][0]({ text, langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, hash: "quality-stream" })
      await vi.waitFor(() => expect(requestTextStreamMock).toHaveBeenCalledOnce())
      await vi.runAllTimersAsync()
      expect(requestTextStreamMock).toHaveBeenCalledTimes(2)
      expect(port.postMessage).not.toHaveBeenCalledWith({ type: "target", targetCode: "eng" })
      expect(port.postMessage).not.toHaveBeenCalledWith({ type: "partial", text })
      expect(port.postMessage).toHaveBeenCalledWith({ type: "done", result: translated("保持代码、标识符、专有名词和行内格式不变。") })
      expect(requestTextStreamMock.mock.calls[1][1].system).toContain("Correct the Invalid Translation Response")
      expect(translationCachePutMock).toHaveBeenCalledOnce()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
