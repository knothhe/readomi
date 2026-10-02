import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { browser } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { detectLanguageWithLLM } from "../language"

const { getLocalConfig, sendMessage, logError } = vi.hoisted(() => ({
  getLocalConfig: vi.fn(),
  sendMessage: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/utils/config/storage", () => ({ getLocalConfig }))
vi.mock("@/utils/message", () => ({ sendMessage }))
vi.mock("@/utils/logger", () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())
const runtimeId = Object.getOwnPropertyDescriptor(browser.runtime, "id")!
const browserI18n = Object.getOwnPropertyDescriptor(browser, "i18n")!

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(browser.runtime, "id", runtimeId)
  Object.defineProperty(browser, "i18n", browserI18n)
})

it("returns a fallback without logging when the config read belongs to an unloaded extension", async () => {
  getLocalConfig.mockRejectedValueOnce(new Error("Extension context invalidated."))
  expect(await detectLanguageWithLLM("English sample for detection")).toBeNull()
  expect(sendMessage).not.toHaveBeenCalled()
  expect(logError).not.toHaveBeenCalled()
})

it("stops retrying when a language request loses its extension context", async () => {
  sendMessage.mockRejectedValue(new Error("Extension context invalidated."))
  expect(await detectLanguageWithLLM("English sample for detection", DEFAULT_CONFIG.providersConfig[0])).toBeNull()
  expect(sendMessage).toHaveBeenCalledOnce()
  expect(logError).not.toHaveBeenCalled()
})

it("keeps logging and retrying ordinary service failures", async () => {
  sendMessage.mockRejectedValue(new Error("Service unavailable"))
  expect(await detectLanguageWithLLM("English sample for detection", DEFAULT_CONFIG.providersConfig[0])).toBeNull()
  expect(sendMessage).toHaveBeenCalledTimes(3)
  expect(logError).toHaveBeenCalledTimes(3)
})

it("does not retry or log a pending message whose channel closes during reload", async () => {
  sendMessage.mockImplementationOnce(() => {
    Object.defineProperty(browser.runtime, "id", { configurable: true, value: undefined })
    return Promise.reject(new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"))
  })
  expect(await detectLanguageWithLLM("English sample for detection", DEFAULT_CONFIG.providersConfig[0])).toBeNull()
  expect(sendMessage).toHaveBeenCalledOnce()
  expect(logError).not.toHaveBeenCalled()
})
