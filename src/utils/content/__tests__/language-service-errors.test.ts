import { beforeEach, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { detectLanguageWithLLM } from "../language"

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }))
vi.mock("@/utils/message", () => ({ sendMessage }))
vi.mock("@/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

beforeEach(() => vi.resetAllMocks())

it.each([400, 401, 403, 404, 429])("stops language detection after an HTTP %i rejection", async (statusCode) => {
  sendMessage.mockRejectedValue(attachRequestErrorMeta(new Error("Request rejected"), { statusCode }))
  expect(await detectLanguageWithLLM("English sample for detection", DEFAULT_CONFIG.providersConfig[0])).toBeNull()
  expect(sendMessage).toHaveBeenCalledOnce()
})

it.each([408, 500, 503])("allows a transient HTTP %i failure to recover", async (statusCode) => {
  sendMessage.mockRejectedValueOnce(attachRequestErrorMeta(new Error("Service unavailable"), { statusCode }))
    .mockResolvedValueOnce({ text: JSON.stringify({ reason: "English text", code: "eng" }) })
  expect(await detectLanguageWithLLM("English sample for detection", DEFAULT_CONFIG.providersConfig[0])).toBe("eng")
  expect(sendMessage).toHaveBeenCalledTimes(2)
})
