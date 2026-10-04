// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { handleTranslationModeChange } from "../handle-config-change"
import { PageTranslationManager } from "../page-translation"

const {
  mockDeepQueryTopLevelSelector,
  mockGetLocalConfig,
  mockGetOrCreateWebPageContext,
  mockRemoveAllTranslatedWrapperNodes,
  mockSendMessage,
  mockTranslateTextForPageTitle,
  mockTranslateWalkedElement,
  mockValidateTranslationConfigAndToast,
  mockWalkAndLabelElement,
} = vi.hoisted(() => ({
  mockGetLocalConfig: vi.fn(),
  mockDeepQueryTopLevelSelector: vi.fn(),
  mockWalkAndLabelElement: vi.fn(),
  mockRemoveAllTranslatedWrapperNodes: vi.fn(),
  mockTranslateWalkedElement: vi.fn(),
  mockTranslateTextForPageTitle: vi.fn(),
  mockGetOrCreateWebPageContext: vi.fn(),
  mockValidateTranslationConfigAndToast: vi.fn(),
  mockSendMessage: vi.fn(),
}))

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: mockGetLocalConfig,
}))

vi.mock("@/utils/host/dom/filter", () => ({
  hasNoWalkAncestor: vi.fn().mockReturnValue(false),
  isDontWalkIntoAndDontTranslateAsChildElement: vi.fn().mockReturnValue(false),
  isDontWalkIntoButTranslateAsChildElement: vi.fn().mockReturnValue(false),
  isHTMLElement: (node: unknown) => node instanceof HTMLElement,
}))

vi.mock("@/utils/host/dom/find", () => ({
  deepQueryTopLevelSelector: mockDeepQueryTopLevelSelector,
}))

vi.mock("@/utils/host/dom/traversal", () => ({
  walkAndLabelElement: mockWalkAndLabelElement,
}))

vi.mock("@/utils/host/translate/node-manipulation", () => ({
  removeAllTranslatedWrapperNodes: mockRemoveAllTranslatedWrapperNodes,
  translateWalkedElement: mockTranslateWalkedElement,
}))

vi.mock("@/utils/host/translate/translate-variants", () => ({
  translateTextForPageTitle: mockTranslateTextForPageTitle,
}))

vi.mock("@/utils/host/translate/webpage-context", () => ({
  getOrCreateWebPageContext: mockGetOrCreateWebPageContext,
}))

vi.mock("@/utils/host/translate/translate-text", () => ({
  validateTranslationConfigAndToast: mockValidateTranslationConfigAndToast,
}))

vi.mock("@/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("@/utils/message", () => ({
  sendMessage: mockSendMessage,
}))

class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()

  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

async function flushDomUpdates(): Promise<void> {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe("pageTranslationManager title handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    document.head.innerHTML = ""
    document.body.innerHTML = "<main>Article body</main>"
    document.title = "Original Title"

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)

    mockGetLocalConfig.mockResolvedValue(DEFAULT_CONFIG)
    mockDeepQueryTopLevelSelector.mockReturnValue([])
    mockGetOrCreateWebPageContext.mockResolvedValue({
      url: window.location.href,
      webTitle: "Original Title",
      webContent: "Article body",
    })
    mockValidateTranslationConfigAndToast.mockReturnValue(true)
    mockSendMessage.mockResolvedValue(undefined)
  })

  it("does not prime webpage context on start for non-llm translation", async () => {
    mockTranslateTextForPageTitle.mockResolvedValue("Translated Title")

    const manager = new PageTranslationManager()
    await manager.start()
    await flushDomUpdates()

    expect(mockGetOrCreateWebPageContext).not.toHaveBeenCalled()

    manager.stop()
  })

  it("primes webpage context on start for AI-aware llm translation", async () => {
    mockGetLocalConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      translate: {
        ...DEFAULT_CONFIG.translate,
        providerId: "openai-default",
        enableAIContentAware: true,
      },
    })
    mockTranslateTextForPageTitle.mockResolvedValue("Translated Title")

    const manager = new PageTranslationManager()
    await manager.start()
    await flushDomUpdates()

    expect(mockGetOrCreateWebPageContext).toHaveBeenCalledTimes(1)

    manager.stop()
  })

  it("translates the tab title on start and restores the latest source title on stop", async () => {
    mockTranslateTextForPageTitle
      .mockResolvedValueOnce("Translated Title")
      .mockResolvedValueOnce("Translated Updated Title")

    const manager = new PageTranslationManager()
    await manager.start()
    await flushDomUpdates()

    expect(document.title).toBe("Translated Title")
    expect(mockTranslateTextForPageTitle).toHaveBeenCalledTimes(1)
    expect(mockTranslateTextForPageTitle).toHaveBeenCalledWith("Original Title")

    document.title = "Updated Source Title"
    await flushDomUpdates()

    expect(mockTranslateTextForPageTitle).toHaveBeenCalledTimes(2)
    expect(mockTranslateTextForPageTitle).toHaveBeenLastCalledWith("Updated Source Title")
    expect(document.title).toBe("Translated Updated Title")

    manager.stop()

    expect(document.title).toBe("Updated Source Title")
    expect(mockSendMessage).toHaveBeenCalledWith("setAndNotifyPageTranslationStateChangedByManager", {
      enabled: true,
      url: window.location.href,
    })
    expect(mockSendMessage).toHaveBeenCalledWith("setAndNotifyPageTranslationStateChangedByManager", {
      enabled: false,
      url: window.location.href,
    })
  })

  it("does not retrigger title translation for its own managed title updates", async () => {
    mockTranslateTextForPageTitle.mockResolvedValue("Translated Title")

    const manager = new PageTranslationManager()
    await manager.start()
    await flushDomUpdates()
    await flushDomUpdates()

    expect(document.title).toBe("Translated Title")
    expect(mockTranslateTextForPageTitle).toHaveBeenCalledTimes(1)

    manager.stop()
  })

  it("ignores stale translation results when the source title changes mid-request", async () => {
    const firstTranslation = createDeferred<string>()
    const secondTranslation = createDeferred<string>()

    mockTranslateTextForPageTitle
      .mockImplementationOnce(() => firstTranslation.promise)
      .mockImplementationOnce(() => secondTranslation.promise)

    const manager = new PageTranslationManager()
    await manager.start()
    await flushDomUpdates()

    document.title = "Updated Source Title"
    await flushDomUpdates()

    expect(mockTranslateTextForPageTitle).toHaveBeenCalledTimes(2)

    firstTranslation.resolve("Stale Translation")
    await flushDomUpdates()

    expect(document.title).toBe("Updated Source Title")

    secondTranslation.resolve("Fresh Translation")
    await flushDomUpdates()

    expect(document.title).toBe("Fresh Translation")

    manager.stop()
    expect(document.title).toBe("Updated Source Title")
  })

  it("ignores a previous language rule's title response after the new response finishes", async () => {
    const oldTranslation = createDeferred<string>()
    const newTranslation = createDeferred<string>()
    mockTranslateTextForPageTitle
      .mockImplementationOnce(() => oldTranslation.promise)
      .mockImplementationOnce(() => newTranslation.promise)
    document.title = "中文原始标题"
    const manager = new PageTranslationManager()
    await manager.start()
    await flushDomUpdates()

    const nextConfig = { ...DEFAULT_CONFIG, language: { ...DEFAULT_CONFIG.language, secondaryCode: "jpn" as const } }
    mockGetLocalConfig.mockResolvedValue(nextConfig)
    handleTranslationModeChange(nextConfig, DEFAULT_CONFIG, manager)
    await flushDomUpdates()
    expect(mockTranslateTextForPageTitle).toHaveBeenCalledTimes(2)
    expect(mockTranslateTextForPageTitle).toHaveBeenLastCalledWith("中文原始标题")

    newTranslation.resolve("新しい翻訳タイトル")
    await flushDomUpdates()
    expect(document.title).toBe("新しい翻訳タイトル")
    oldTranslation.resolve("Old English title")
    await flushDomUpdates()
    expect(document.title).toBe("新しい翻訳タイトル")

    manager.stop()
    expect(document.title).toBe("中文原始标题")
  })

  it("disposes while startup is awaiting config without enabling the page or installing observers", async () => {
    const config = createDeferred<typeof DEFAULT_CONFIG>()
    mockGetLocalConfig.mockReturnValueOnce(config.promise)
    const manager = new PageTranslationManager()
    const startup = manager.start()
    manager.dispose()
    config.resolve(DEFAULT_CONFIG)
    await startup
    expect(manager.isActive).toBe(false)
    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(mockWalkAndLabelElement).not.toHaveBeenCalled()
    await manager.start()
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it("disconnects title and body observers on disposal while preserving completed translations", async () => {
    mockTranslateTextForPageTitle.mockResolvedValueOnce("Translated Title")
    const manager = new PageTranslationManager()
    await manager.start()
    await flushDomUpdates()
    expect(document.title).toBe("Translated Title")
    mockGetLocalConfig.mockClear()
    mockSendMessage.mockClear()
    manager.dispose()
    expect(document.title).toBe("Translated Title")
    expect(mockRemoveAllTranslatedWrapperNodes).not.toHaveBeenCalled()
    document.title = "A new source title after update"
    document.body.append(document.createElement("p"))
    await flushDomUpdates()
    expect(mockTranslateTextForPageTitle).toHaveBeenCalledOnce()
    expect(mockGetLocalConfig).not.toHaveBeenCalled()
    expect(mockSendMessage).not.toHaveBeenCalledWith("setAndNotifyPageTranslationStateChangedByManager", expect.anything())
  })
})
