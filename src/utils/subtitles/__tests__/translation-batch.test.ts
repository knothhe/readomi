import type { SubtitleBatchOutcome, SubtitleBatchRequest } from "../translation-batch"
import { expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { translateSubtitleBatch } from "../translation-batch"

const messages = vi.hoisted(() => ({ send: vi.fn(), listen: vi.fn(), unsubscribe: vi.fn() }))
vi.mock("@/utils/message", () => ({ sendMessage: messages.send, onMessage: messages.listen }))

it("routes concurrent progress to its request and ignores updates after cancellation", async () => {
  const pending = new Map<string, (outcomes: SubtitleBatchOutcome[]) => void>()
  messages.listen.mockReturnValue(messages.unsubscribe)
  messages.send.mockImplementation((type: string, data: SubtitleBatchRequest) => type === "cancelSubtitleBatch"
    ? Promise.resolve()
    : new Promise<SubtitleBatchOutcome[]>(resolve => pending.set(data.requestId, resolve)))
  const options = { items: [{ id: "a", text: "Source", before: [], after: [] }], langConfig: DEFAULT_CONFIG.language, providerConfig: DEFAULT_CONFIG.providersConfig[0], customPromptsConfig: DEFAULT_CONFIG.translate.customPromptsConfig, pageUrl: "https://youtube.com/watch?v=test", urgent: true }
  const controller = new AbortController()
  const firstProgress = vi.fn()
  const secondProgress = vi.fn()
  const first = translateSubtitleBatch(options, controller.signal, firstProgress)
  const second = translateSubtitleBatch(options, new AbortController().signal, secondProgress)
  const [firstId, secondId] = [...pending.keys()]
  const dispatch = messages.listen.mock.calls[0][1]
  const outcomes = [{ id: "a", result: { action: "translate" as const, text: "译文" } }]
  dispatch({ data: { requestId: firstId, outcomes } })
  expect(firstProgress).toHaveBeenCalledExactlyOnceWith(outcomes)
  expect(secondProgress).not.toHaveBeenCalled()
  controller.abort()
  dispatch({ data: { requestId: firstId, outcomes } })
  expect(firstProgress).toHaveBeenCalledOnce()
  const aborted = expect(first).rejects.toThrow()
  pending.get(firstId)!(outcomes)
  await aborted
  expect(messages.unsubscribe).not.toHaveBeenCalled()
  dispatch({ data: { requestId: secondId, outcomes } })
  expect(secondProgress).toHaveBeenCalledExactlyOnceWith(outcomes)
  pending.get(secondId)!(outcomes)
  await second
  expect(messages.unsubscribe).toHaveBeenCalledOnce()
})
