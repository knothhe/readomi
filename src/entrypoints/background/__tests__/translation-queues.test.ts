import type { ProviderConfig } from "@/types/config/provider"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "#imports"
import { DEFAULT_CONFIG as READING_DEFAULT_CONFIG } from "@/utils/constants/config"
import { TRANSLATION_PROTOCOL_VERSION } from "@/utils/host/translate/translation-result"

// These protocol tests exercise both translation directions explicitly.
const DEFAULT_CONFIG = { ...READING_DEFAULT_CONFIG, language: { ...READING_DEFAULT_CONFIG.language, secondaryCode: "eng" as const } }

const onMessageMock = vi.fn()
const ensureInitializedConfigMock = vi.fn()
const executeTranslateMock = vi.fn()
const requestTextStreamMock = vi.fn()
const generateArticleSummaryMock = vi.fn()
const articleSummaryCacheGetMock = vi.fn()
const articleSummaryCachePutMock = vi.fn()
const articleSummaryCacheClearMock = vi.fn()
const translationCacheGetMock = vi.fn()
const translationCachePutMock = vi.fn()
const translationCacheDeleteMock = vi.fn()
const translationCacheClearMock = vi.fn()
const pageTranslationCacheClearMock = vi.fn()
const pageSummaryCacheClearMock = vi.fn()
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
      clear: articleSummaryCacheClearMock,
      deleteByPage: pageSummaryCacheClearMock,
    },
    translationCache: {
      get: translationCacheGetMock,
      put: translationCachePutMock,
      delete: translationCacheDeleteMock,
      clear: translationCacheClearMock,
      deleteByPage: pageTranslationCacheClearMock,
    },
  },
}))

function getRegisteredMessageHandler(name: string) {
  const registration = onMessageMock.mock.calls.find(call => call[0] === name)
  if (!registration) {
    throw new Error(`Message handler not registered: ${name}`)
  }
  return registration[1] as (message: { data: Record<string, unknown>, sender?: { tab?: { url?: string } } }) => Promise<unknown>
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function hoverPort() {
  const port = { name: "readomi-hover-translation", onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() }, postMessage: vi.fn() }
  const connect = vi.mocked(browser.runtime.onConnect.addListener).mock.calls[0][0]
  connect(port as unknown as Parameters<typeof connect>[0])
  return port
}

function translationData(hash: string) {
  return { text: "Hello", langConfig: DEFAULT_CONFIG.language, providerConfig: llmProvider, scheduleAt: Date.now(), hash }
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
    translationCacheClearMock.mockResolvedValue(undefined)
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

  it("clears both translation and summary caches from settings", async () => {
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const clear = getRegisteredMessageHandler("clearTranslationCache")
    await expect(clear({ data: {} })).resolves.toBeUndefined()
    expect(translationCacheClearMock).toHaveBeenCalledOnce()
    expect(articleSummaryCacheClearMock).toHaveBeenCalledOnce()
  })

  it("does not cache a pre-clear request or deduplicate a new identical request against it", async () => {
    const old = deferred<string>()
    executeTranslateMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response("新的译文"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const clear = getRegisteredMessageHandler("clearTranslationCache")
    const first = handler({ data: translationData("same-cache-key") })
    await vi.waitFor(() => expect(executeTranslateMock).toHaveBeenCalledOnce())
    await clear({ data: {} })
    const second = handler({ data: translationData("same-cache-key") })
    await expect(second).resolves.toEqual(translated("新的译文"))
    expect(executeTranslateMock).toHaveBeenCalledTimes(2)
    old.resolve(response("清空前的译文"))
    await expect(first).resolves.toEqual(translated("清空前的译文"))
    expect(translationCachePutMock).toHaveBeenCalledOnce()
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ key: "same-cache-key", translation: "新的译文" }))
  })

  it("finishes a pre-clear hover request without writing its result back", async () => {
    const old = deferred<string>()
    requestTextStreamMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response("新的悬停译文"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const clear = getRegisteredMessageHandler("clearTranslationCache")
    const first = hoverPort()
    first.onMessage.addListener.mock.calls[0][0](translationData("same-hover-key"))
    await vi.waitFor(() => expect(requestTextStreamMock).toHaveBeenCalledOnce())
    await clear({ data: {} })
    const second = hoverPort()
    second.onMessage.addListener.mock.calls[0][0](translationData("same-hover-key"))
    await vi.waitFor(() => expect(second.postMessage).toHaveBeenCalledWith({ type: "done", result: translated("新的悬停译文") }))
    old.resolve(response("旧的悬停译文"))
    await vi.waitFor(() => expect(first.postMessage).toHaveBeenCalledWith({ type: "done", result: translated("旧的悬停译文") }))
    expect(translationCachePutMock).toHaveBeenCalledOnce()
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ key: "same-hover-key", translation: "新的悬停译文" }))
  })

  it("waits for an active cache write before clearing and waits for the clear before new reads", async () => {
    const write = deferred<void>()
    const clearing = deferred<void>()
    translationCachePutMock.mockReturnValueOnce(write.promise)
    translationCacheClearMock.mockReturnValueOnce(clearing.promise)
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const clear = getRegisteredMessageHandler("clearTranslationCache")
    const first = handler({ data: translationData("writing-before-clear") })
    await vi.waitFor(() => expect(translationCachePutMock).toHaveBeenCalledOnce())
    const pendingClear = clear({ data: {} })
    const second = handler({ data: translationData("reading-after-clear") })
    await Promise.resolve()
    expect(translationCacheClearMock).not.toHaveBeenCalled()
    expect(translationCacheGetMock).toHaveBeenCalledOnce()
    write.resolve(undefined)
    await first
    await vi.waitFor(() => expect(translationCacheClearMock).toHaveBeenCalledOnce())
    expect(translationCacheGetMock).toHaveBeenCalledOnce()
    clearing.resolve(undefined)
    await pendingClear
    await second
    expect(translationCacheGetMock).toHaveBeenCalledTimes(2)
  })

  it("does not let a stale cache audit delete a new same-key result after a clear", async () => {
    const oldRead = deferred<{ translation: string, protocolVersion: string }>()
    translationCacheGetMock.mockReturnValueOnce(oldRead.promise)
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    const clear = getRegisteredMessageHandler("clearTranslationCache")
    const first = handler({ data: translationData("stale-audit") })
    await vi.waitFor(() => expect(translationCacheGetMock).toHaveBeenCalledOnce())
    await clear({ data: {} })
    await handler({ data: translationData("stale-audit") })
    oldRead.resolve({ translation: "旧缓存", protocolVersion: "automatic-language-v1" })
    await first
    expect(translationCacheDeleteMock).not.toHaveBeenCalled()
    expect(translationCachePutMock).toHaveBeenCalledOnce()
  })

  it("reports a clear failure and permits a later clear and cache write", async () => {
    translationCacheClearMock.mockRejectedValueOnce(new Error("Storage unavailable"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const clear = getRegisteredMessageHandler("clearTranslationCache")
    await expect(clear({ data: {} })).rejects.toThrow("Storage unavailable")
    await expect(clear({ data: {} })).resolves.toBeUndefined()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await expect(handler({ data: translationData("after-clear-retry") })).resolves.toEqual(translated("translated text"))
    expect(translationCacheClearMock).toHaveBeenCalledTimes(2)
    expect(translationCachePutMock).toHaveBeenCalledOnce()
  })

  it("reports a cache write failure without poisoning a later clear", async () => {
    translationCachePutMock.mockRejectedValueOnce(new Error("Write failed"))
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const handler = getRegisteredMessageHandler("enqueueTranslateRequest")
    await expect(handler({ data: translationData("failed-write") })).rejects.toThrow("Write failed")
    const clear = getRegisteredMessageHandler("clearTranslationCache")
    await expect(clear({ data: {} })).resolves.toBeUndefined()
    await expect(handler({ data: translationData("successful-write") })).resolves.toEqual(translated("translated text"))
    expect(translationCachePutMock).toHaveBeenCalledTimes(2)
  })
  it("shares web translations across paths and clears the domain while keeping other domains and page summaries", async () => {
    const records = new Map<string, { key: string, pageKey: string }>()
    const summaries = new Map<string, { key: string, pageKey: string }>()
    translationCacheGetMock.mockImplementation(async key => records.get(key))
    translationCachePutMock.mockImplementation(async (record) => {
      records.set(record.key, record)
    })
    articleSummaryCacheGetMock.mockImplementation(async key => summaries.get(key))
    articleSummaryCachePutMock.mockImplementation(async (record) => {
      summaries.set(record.key, record)
    })
    pageTranslationCacheClearMock.mockImplementation(async (pageKey) => {
      for (const [key, record] of records) {
        if (record.pageKey === pageKey)
          records.delete(key)
      }
    })
    pageSummaryCacheClearMock.mockImplementation(async (pageKey) => {
      for (const [key, record] of summaries) {
        if (record.pageKey === pageKey)
          summaries.delete(key)
      }
    })
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ id: 7, url: "https://example.com/a" } as unknown as Awaited<ReturnType<typeof browser.tabs.get>>)
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const request = getRegisteredMessageHandler("enqueueTranslateRequest")
    const summary = getRegisteredMessageHandler("getOrGenerateWebPageSummary")
    const clear = getRegisteredMessageHandler("clearPageTranslationCache")
    for (const pageUrl of ["https://example.com/a", "http://EXAMPLE.com:8080/b?tracking=1#section", "https://other.example/a"]) {
      await request({ data: { ...translationData("same-text"), pageUrl }, sender: { tab: { url: "chrome-extension://readomi/popup.html" } } })
      await summary({ data: { webTitle: "Same title", webContent: "Same article", providerConfig: llmProvider, pageUrl } })
    }
    expect(records.size).toBe(2)
    expect(summaries.size).toBe(3)
    expect(executeTranslateMock).toHaveBeenCalledTimes(2)
    await clear({ data: { tabId: 7, url: "https://example.com/a" } })
    expect(records.size).toBe(1)
    expect(summaries.size).toBe(2)
    await request({ data: { ...translationData("same-text"), pageUrl: "https://other.example/a" } })
    expect(executeTranslateMock).toHaveBeenCalledTimes(2)
    await request({ data: { ...translationData("same-text"), pageUrl: "https://example.com/a" } })
    expect(executeTranslateMock).toHaveBeenCalledTimes(3)
  })

  it("keeps subtitle requests page-scoped and subdomains separate", async () => {
    const { sha256Hex } = await import("@/utils/hash")
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const request = getRegisteredMessageHandler("enqueueTranslateRequest")
    for (const pageUrl of ["https://example.com/a", "https://example.com/b?video=2"]) {
      await request({ data: { ...translationData("same-subtitle"), pageUrl, cacheScope: "page" } })
      expect(translationCachePutMock).toHaveBeenLastCalledWith(expect.objectContaining({ pageKey: await sha256Hex(pageUrl) }))
    }
    for (const hostname of ["example.com", "www.example.com", "news.example.com"]) {
      await request({ data: { ...translationData("same-text"), pageUrl: `https://${hostname}/a` } })
      expect(translationCachePutMock).toHaveBeenLastCalledWith(expect.objectContaining({ pageKey: await sha256Hex(`domain:${hostname}`) }))
    }
    expect(new Set(translationCachePutMock.mock.calls.map(([record]) => record.key)).size).toBe(5)
  })

  it("uses the top-level domain for embedded web text and clears both domain and page scopes", async () => {
    const url = "https://example.com/article?tracking=1"
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ id: 7, url } as unknown as Awaited<ReturnType<typeof browser.tabs.get>>)
    const { sha256Hex } = await import("@/utils/hash")
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    await getRegisteredMessageHandler("enqueueTranslateRequest")({
      data: { ...translationData("frame-text"), pageUrl: "https://embedded.example/player" },
      sender: { tab: { url } },
    })
    const domainKey = await sha256Hex("domain:example.com")
    const pageKey = await sha256Hex(url)
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ pageKey: domainKey }))
    await getRegisteredMessageHandler("clearPageTranslationCache")({ data: { tabId: 7, url } })
    expect(pageTranslationCacheClearMock).toHaveBeenCalledWith(domainKey)
    expect(pageTranslationCacheClearMock).toHaveBeenCalledWith(pageKey)
    expect(pageSummaryCacheClearMock).toHaveBeenCalledExactlyOnceWith(pageKey)
  })

  it("blocks pre-clear domain results from writing back without blocking another domain's result", async () => {
    const oldA = deferred<string>()
    const pendingB = deferred<string>()
    executeTranslateMock.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(pendingB.promise).mockResolvedValue(response("新结果"))
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ id: 7, url: "https://example.com/a" } as unknown as Awaited<ReturnType<typeof browser.tabs.get>>)
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    const request = getRegisteredMessageHandler("enqueueTranslateRequest")
    const firstA = request({ data: { ...translationData("old-a"), pageUrl: "https://example.com/another?tracking=1" } })
    await vi.waitFor(() => expect(executeTranslateMock).toHaveBeenCalledTimes(1))
    const firstB = request({ data: { ...translationData("other-b"), pageUrl: "https://other.example/b" } })
    await vi.waitFor(() => expect(executeTranslateMock).toHaveBeenCalledTimes(2))
    await getRegisteredMessageHandler("clearPageTranslationCache")({ data: { tabId: 7, url: "https://example.com/a" } })
    oldA.resolve(response("旧结果"))
    pendingB.resolve(response("其他页结果"))
    await Promise.all([firstA, firstB])
    expect(translationCachePutMock).toHaveBeenCalledOnce()
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ translation: "其他页结果" }))
    await request({ data: { ...translationData("old-a"), pageUrl: "https://example.com/a" } })
    expect(translationCachePutMock).toHaveBeenCalledTimes(2)
  })

  it("scopes embedded local-file requests to their top-level page when clearing", async () => {
    const url = "file:///reader/article.html"
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ id: 7, url } as unknown as Awaited<ReturnType<typeof browser.tabs.get>>)
    const { sha256Hex } = await import("@/utils/hash")
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    await getRegisteredMessageHandler("enqueueTranslateRequest")({
      data: { ...translationData("local-frame"), pageUrl: "file:///reader/player.html" },
      sender: { tab: { url } },
    })
    const pageKey = await sha256Hex(url)
    expect(translationCachePutMock).toHaveBeenCalledWith(expect.objectContaining({ pageKey }))
    await getRegisteredMessageHandler("clearPageTranslationCache")({ data: { tabId: 7, url } })
    expect(pageTranslationCacheClearMock).toHaveBeenCalledWith(pageKey)
    expect(pageSummaryCacheClearMock).toHaveBeenCalledWith(pageKey)
  })

  it("refuses a page cache clear after the selected tab navigates", async () => {
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ id: 7, url: "https://example.com/b" } as unknown as Awaited<ReturnType<typeof browser.tabs.get>>)
    const { setUpWebPageTranslationQueue } = await import("../translation-queues")
    setUpWebPageTranslationQueue()
    await expect(getRegisteredMessageHandler("clearPageTranslationCache")({ data: { tabId: 7, url: "https://example.com/a" } })).rejects.toThrow("page changed")
    expect(pageTranslationCacheClearMock).not.toHaveBeenCalled()
    expect(pageSummaryCacheClearMock).not.toHaveBeenCalled()
  })
})
