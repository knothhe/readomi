import { describe, expect, it } from "vitest"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"
import { parseTranslationPartial, parseTranslationResult } from "../translation-result"

const bilingual = { targetCode: "cmn", secondaryCode: "eng" } as const
const preserve = { targetCode: "cmn", secondaryCode: "original" } as const

describe("translation direction responses", () => {
  it("returns the actual target of each route", () => {
    expect(parseTranslationResult("[[readomi:primary]]\n中文译文", bilingual)).toEqual({ action: "translate", text: "中文译文", targetCode: "cmn" })
    expect(parseTranslationResult("[[readomi:secondary]]\nEnglish translation", bilingual)).toEqual({ action: "translate", text: "English translation", targetCode: "eng" })
  })

  it("represents preserved text without asking the model to repeat the source", () => {
    expect(parseTranslationResult("[[readomi:preserve]]", preserve)).toEqual({ action: "preserve", text: "" })
    expect(parseTranslationResult("[[readomi:preserve]]", { targetCode: "cmn", secondaryCode: "cmn-Hant" })).toEqual({ action: "preserve", text: "" })
  })

  it.each([
    "Bare output without a route",
    "[[readomi:unknown]]\nA translation",
    "[[readomi:primary]]",
    "[[readomi:preserve]]",
  ])("rejects malformed or unavailable output: %s", (response) => {
    expect(() => parseTranslationResult(response, bilingual)).toThrow()
  })

  it("does not accept replacement text for a preserved paragraph or an unavailable secondary route", () => {
    expect(() => parseTranslationResult("[[readomi:preserve]]\n改写的原文", preserve)).toThrow()
    expect(() => parseTranslationResult("[[readomi:secondary]]\nEnglish", preserve)).toThrow()
  })

  it("marks model-format errors retryable", () => {
    try {
      parseTranslationResult("Invalid", bilingual)
    }
    catch (error) {
      expect(getRequestErrorMeta(error).isRetryable).toBe(true)
    }
  })

  it("buffers a header split across stream chunks and exposes only the following text", () => {
    for (const fragment of ["", "[[read", "[[readomi:secondary", "[[readomi:secondary]]"])
      expect(parseTranslationPartial(fragment, bilingual)).toBeUndefined()
    expect(parseTranslationPartial("[[readomi:secondary]]\r\nEnglish", bilingual)).toEqual({ action: "translate", text: "English", targetCode: "eng" })
  })

  it("never reveals preserved content or malformed streaming headers", () => {
    expect(parseTranslationPartial("[[readomi:preserve]]\n", preserve)).toEqual({ action: "preserve", text: "" })
    expect(parseTranslationPartial("[[readomi:secondary]]\nEnglish", preserve)).toBeUndefined()
    expect(parseTranslationPartial("Invalid\nText", bilingual)).toBeUndefined()
  })
})
