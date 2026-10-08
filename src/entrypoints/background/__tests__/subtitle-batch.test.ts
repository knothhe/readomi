import type { SubtitleBatchOutcome, SubtitleBatchRequest, SubtitleTranslationItem } from "@/utils/subtitles/translation-batch"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { executeTranslate } from "@/utils/host/translate/execute-translate"
import { RequestQueue } from "@/utils/request/request-queue"
import { executeSubtitleBatch, parseSubtitleBatch } from "../subtitle-batch"

vi.mock("@/utils/host/translate/execute-translate", () => ({ executeTranslate: vi.fn() }))
const translate = vi.mocked(executeTranslate)
const items: SubtitleTranslationItem[] = [
  { id: "a", text: "First sentence.", before: [], after: ["Second sentence."] },
  { id: "b", text: "Second sentence.", before: ["First sentence."], after: [] },
]
const request: SubtitleBatchRequest = { requestId: "test", items, langConfig: { ...DEFAULT_CONFIG.language, secondaryCode: "eng" }, providerConfig: DEFAULT_CONFIG.providersConfig[0], customPromptsConfig: DEFAULT_CONFIG.translate.customPromptsConfig, pageUrl: "https://youtube.com/watch?v=test", urgent: false }
const reply = (id: string, text = "中文译文") => ({ id, translation: `[[readomi:primary]]\n${text}` })
const queue = () => new RequestQueue({ rate: 100, capacity: 100, timeoutMs: 20_000, maxRetries: 0, baseRetryDelayMs: 0 })

beforeEach(() => vi.clearAllMocks())

describe("subtitle batch alignment and recovery", () => {
  it("aligns reordered IDs and keeps valid cues when another cue is missing", () => {
    const result = parseSubtitleBatch(JSON.stringify([reply("b"), reply("unknown")]), items, request)
    expect(result[0]).toMatchObject({ id: "a", error: expect.any(String) })
    expect(result[1]).toMatchObject({ id: "b", result: { text: "中文译文" } })
    const reordered = parseSubtitleBatch(JSON.stringify([reply("b", "第二句"), reply("a", "第一句")]), items, request)
    expect(reordered.map(item => item.result?.text)).toEqual(["第一句", "第二句"])
  })

  it("accepts Magpie's inline route headers without corrective requests", async () => {
    // Actual gpt-luna output used a route immediately followed by the prose.
    const item = { id: "cue-159", text: "jack. This is not an SD card reader,", before: ["main ports, two USBCs, and a headphone"], after: ["it's the speaker. We got side-firing"] }
    const raw = JSON.stringify([{ id: item.id, translation: "[[readomi:primary]]jack。这不是 SD 卡读卡器，" }])
    translate.mockResolvedValue(raw)
    const outcomes = await executeSubtitleBatch({ ...request, items: [item] }, queue(), new AbortController().signal)
    expect(outcomes[0].result).toEqual({ action: "translate", text: "jack。这不是 SD 卡读卡器，", targetCode: "cmn" })
    expect(translate).toHaveBeenCalledOnce()
    // A whitespace repair must not accept the wrong language direction.
    expect(parseSubtitleBatch(JSON.stringify([{ id: item.id, translation: "[[readomi:secondary]]Wrong direction" }]), [item], { langConfig: { ...request.langConfig, secondaryCode: "original" } })[0].error).toBeDefined()
  })

  it("publishes valid cues before a missing cue's slow retry completes", async () => {
    let resolve!: (raw: string) => void
    translate.mockResolvedValueOnce(JSON.stringify([reply("a")])).mockImplementationOnce(() => new Promise<string>(r => resolve = r))
    const progress = vi.fn(async (_outcomes: SubtitleBatchOutcome[]) => {})
    const pending = executeSubtitleBatch(request, queue(), new AbortController().signal, progress)
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2))
    expect(progress).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ id: "a", result: { action: "translate", text: "中文译文", targetCode: "cmn" } })])
    resolve(JSON.stringify([reply("b")]))
    const outcomes = await pending
    expect(outcomes.every(outcome => outcome.result)).toBe(true)
    expect(progress.mock.calls[1][0]).toEqual([expect.objectContaining({ id: "b", result: expect.any(Object) })])
  })

  it("rejects duplicate IDs, invalid language directions and malformed preserved cues", () => {
    expect(parseSubtitleBatch(JSON.stringify([reply("a"), reply("a"), { id: "b", translation: "[[readomi:secondary]]\nWrong direction" }]), items, { langConfig: { ...request.langConfig, secondaryCode: "original" } }).every(item => item.error)).toBe(true)
    const preserved = [{ ...items[0], text: "中文原文" }]
    const language = { langConfig: { ...DEFAULT_CONFIG.language, secondaryCode: "original" as const } }
    expect(parseSubtitleBatch(JSON.stringify([{ id: "a", translation: "[[readomi:preserve]]" }]), preserved, language)[0].result).toEqual({ action: "preserve", text: "" })
    expect(parseSubtitleBatch(JSON.stringify([{ id: "a", translation: "[[readomi:preserve]]\nextra" }]), preserved, language)[0].error).toBeDefined()
  })

  it("retries only the missing cue and includes context and the ID contract", async () => {
    translate.mockResolvedValueOnce(JSON.stringify([reply("b")])).mockResolvedValueOnce(JSON.stringify([reply("a")]))
    const outcomes = await executeSubtitleBatch(request, queue(), new AbortController().signal)
    expect(outcomes.every(outcome => outcome.result)).toBe(true)
    expect(translate).toHaveBeenCalledTimes(2)
    expect(translate.mock.calls[1][0]).toBe("First sentence.")
    const call = translate.mock.calls[0]
    const prompt = await call[3]("automatic", call[0], { ...call[4], languagePolicy: request.langConfig })
    expect(prompt.systemPrompt).toContain("\"id\" and \"translation\"")
    expect(prompt.prompt).toContain(JSON.stringify(items))
  })

  it("splits only the failed request and falls back to individual translation", async () => {
    translate.mockImplementation(async (_text, _language, _provider, _resolver, options) => options?.isBatch ? "invalid JSON" : "[[readomi:primary]]\n单条译文")
    const outcomes = await executeSubtitleBatch(request, queue(), new AbortController().signal)
    expect(outcomes.map(outcome => outcome.result?.text)).toEqual(["单条译文", "单条译文"])
    translate.mockClear().mockResolvedValue(JSON.stringify([reply("a"), reply("b")]))
    await executeSubtitleBatch({ ...request, requestId: "next" }, queue(), new AbortController().signal)
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it("does not split transport errors into a storm of individual requests", async () => {
    translate.mockRejectedValue(new Error("429 Too many requests"))
    const outcomes = await executeSubtitleBatch(request, queue(), new AbortController().signal)
    expect(outcomes.every(outcome => outcome.error?.includes("429"))).toBe(true)
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it("skips a queued old-position request after cancellation", async () => {
    const blocked = new RequestQueue({ rate: 100, capacity: 1, timeoutMs: 20_000, maxRetries: 0, baseRetryDelayMs: 0 })
    await blocked.enqueue(async () => "occupied", Date.now(), "occupied")
    const controller = new AbortController()
    const pending = executeSubtitleBatch(request, blocked, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(translate).not.toHaveBeenCalled()
  })
})
