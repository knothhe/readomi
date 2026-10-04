import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser, storage } from "#imports"
import { getTranslationStateKey } from "@/utils/constants/storage-keys"

const sendMessageMock = vi.fn()
const onMessageMock = vi.fn()
const storageGetItemMock = vi.fn()
const storageSetItemMock = vi.fn()
const storageRemoveItemMock = vi.fn()
const tabsOnRemovedAddListenerMock = vi.fn()
const tabsQueryMock = vi.fn()
const webNavigationOnCommittedAddListenerMock = vi.fn()
const injectHostContentIntoTabIframesMock = vi.fn()
const updateActionIconMock = vi.fn()
const loggerErrorMock = vi.fn()
const loggerWarnMock = vi.fn()

const messageHandlers = new Map<string, (msg: any) => any>()

vi.mock("@/utils/message", () => ({
  onMessage: onMessageMock,
  sendMessage: sendMessageMock,
}))

vi.mock("@/utils/logger", () => ({
  logger: {
    error: loggerErrorMock,
    warn: loggerWarnMock,
  },
}))

vi.mock("../iframe-injection", () => ({
  injectHostContentIntoTabIframes: injectHostContentIntoTabIframesMock,
}))

vi.mock("../action-icon", () => ({
  updateActionIcon: updateActionIconMock,
}))

function getHandler(name: string) {
  const handler = messageHandlers.get(name)
  if (!handler) {
    throw new Error(`Expected message handler to be registered: ${name}`)
  }
  return handler
}

function getOnCommittedListener() {
  const listener = webNavigationOnCommittedAddListenerMock.mock.calls.at(-1)?.[0]
  if (!listener) {
    throw new Error("Expected webNavigation.onCommitted listener to be registered")
  }
  return listener as (details: { tabId: number, frameId: number, url: string }) => Promise<void>
}

function getOnRemovedListener() {
  const listener = tabsOnRemovedAddListenerMock.mock.calls.at(-1)?.[0]
  if (!listener) {
    throw new Error("Expected tabs.onRemoved listener to be registered")
  }
  return listener as (tabId: number) => Promise<void>
}

async function setupSubject() {
  const { translationMessage } = await import("../translation-signal")
  translationMessage()
}

describe("translationMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    messageHandlers.clear()

    browser.tabs.onRemoved.addListener = tabsOnRemovedAddListenerMock
    browser.tabs.query = tabsQueryMock
    browser.webNavigation.onCommitted.addListener = webNavigationOnCommittedAddListenerMock
    storage.getItem = storageGetItemMock
    storage.setItem = storageSetItemMock
    storage.removeItem = storageRemoveItemMock

    onMessageMock.mockImplementation((name: string, handler: (msg: any) => any) => {
      messageHandlers.set(name, handler)
      return vi.fn()
    })
    sendMessageMock.mockResolvedValue(undefined)
    tabsQueryMock.mockResolvedValue([{ id: 42 }])
    storageGetItemMock.mockResolvedValue(undefined)
    storageSetItemMock.mockResolvedValue(undefined)
    storageRemoveItemMock.mockResolvedValue(undefined)
  })

  it("persists manager-enabled state and injects current iframes from the top frame", async () => {
    await setupSubject()

    await getHandler("setAndNotifyPageTranslationStateChangedByManager")({
      data: { enabled: true, url: "https://example.com/articles/1" },
      sender: { tab: { id: 42 }, frameId: 0 },
    })

    expect(storageSetItemMock).toHaveBeenCalledWith(getTranslationStateKey(42), {
      enabled: true,
      origin: "https://example.com",
    })
    expect(sendMessageMock).toHaveBeenCalledWith("notifyTranslationStateChanged", { enabled: true }, 42)
    expect(injectHostContentIntoTabIframesMock).toHaveBeenCalledWith(42)
  })

  it("does not overwrite tab state or reinject every iframe when an iframe manager echoes enabled state", async () => {
    await setupSubject()
    storageGetItemMock.mockResolvedValue({ enabled: true, origin: "https://example.com" })

    await getHandler("setAndNotifyPageTranslationStateChangedByManager")({
      data: { enabled: true, url: "https://embed.example.net/frame" },
      sender: { tab: { id: 42 }, frameId: 7 },
    })

    expect(storageSetItemMock).not.toHaveBeenCalled()
    expect(sendMessageMock).toHaveBeenCalledWith("notifyTranslationStateChanged", { enabled: true }, 42)
    expect(injectHostContentIntoTabIframesMock).not.toHaveBeenCalled()
  })

  it("ignores enabled iframe manager echoes when tab translation is not already active", async () => {
    await setupSubject()
    storageGetItemMock.mockResolvedValue(undefined)

    await getHandler("setAndNotifyPageTranslationStateChangedByManager")({
      data: { enabled: true, url: "https://embed.example.net/frame" },
      sender: { tab: { id: 42 }, frameId: 7 },
    })

    expect(storageSetItemMock).not.toHaveBeenCalled()
    expect(sendMessageMock).not.toHaveBeenCalledWith("notifyTranslationStateChanged", { enabled: true }, 42)
    expect(injectHostContentIntoTabIframesMock).not.toHaveBeenCalled()
  })

  it("clears state immediately when a tab-level request disables page translation", async () => {
    await setupSubject()

    await getHandler("tryToSetEnablePageTranslationByTabId")({
      data: { tabId: 42, enabled: false },
    })

    expect(storageSetItemMock).toHaveBeenCalledWith(getTranslationStateKey(42), { enabled: false })
    expect(sendMessageMock).toHaveBeenCalledWith("notifyTranslationStateChanged", { enabled: false }, 42)
    expect(sendMessageMock).toHaveBeenCalledWith("askManagerToTogglePageTranslation", { enabled: false }, 42)
  })

  it("accepts legacy page-language reports without caching or publishing", async () => {
    await setupSubject()

    expect(await getHandler("reportDetectedPageLanguage")({
      data: { detectedCodeOrUnd: "cmn", url: "https://zh.example.test" },
      sender: { tab: { id: 42 }, frameId: 0 },
    })).toBeUndefined()

    expect(storageGetItemMock).not.toHaveBeenCalled()
    expect(storageSetItemMock).not.toHaveBeenCalled()
    expect(tabsQueryMock).not.toHaveBeenCalled()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it("answers legacy language queries without reading page detection state", async () => {
    await setupSubject()

    expect(await getHandler("getDetectedCode")({
      data: undefined,
      sender: { tab: { id: 42 }, frameId: 0 },
    })).toBe("eng")
    expect(await getHandler("getDetectedCode")({
      data: undefined,
      sender: {},
    })).toBe("eng")

    expect(storageGetItemMock).not.toHaveBeenCalled()
    expect(tabsQueryMock).not.toHaveBeenCalled()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it("waits for the top-frame manager to validate before enabling iframe injection", async () => {
    await setupSubject()

    await getHandler("tryToSetEnablePageTranslationByTabId")({
      data: { tabId: 42, enabled: true },
    })

    expect(storageSetItemMock).not.toHaveBeenCalled()
    expect(injectHostContentIntoTabIframesMock).not.toHaveBeenCalled()
    expect(sendMessageMock).toHaveBeenCalledWith("askManagerToTogglePageTranslation", { enabled: true }, 42)
  })

  it("clears translation state when a tab is removed", async () => {
    await setupSubject()

    await getOnRemovedListener()(42)

    expect(storageRemoveItemMock).toHaveBeenCalledWith(getTranslationStateKey(42))
  })

  it("keeps enabled translation state on same-origin top-frame navigation", async () => {
    await setupSubject()
    storageGetItemMock.mockResolvedValue({ enabled: true, origin: "https://example.com" })

    await getOnCommittedListener()({
      tabId: 42,
      frameId: 0,
      url: "https://example.com/articles/2?from=feed#comments",
    })

    expect(storageRemoveItemMock).not.toHaveBeenCalled()
  })

  it("clears enabled translation state on cross-origin top-frame navigation", async () => {
    await setupSubject()
    storageGetItemMock.mockResolvedValue({ enabled: true, origin: "https://example.com" })

    await getOnCommittedListener()({
      tabId: 42,
      frameId: 0,
      url: "https://other.example.com/articles/2",
    })

    expect(storageRemoveItemMock).toHaveBeenCalledWith(getTranslationStateKey(42))
  })

  it("does not clear translation state for iframe navigations", async () => {
    await setupSubject()

    await getOnCommittedListener()({
      tabId: 42,
      frameId: 3,
      url: "https://other.example.com/frame",
    })

    expect(storageGetItemMock).not.toHaveBeenCalled()
    expect(storageRemoveItemMock).not.toHaveBeenCalled()
  })
})
