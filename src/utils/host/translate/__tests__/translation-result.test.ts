import { describe, expect, it } from "vitest"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"
import { parseTranslationPartial, parseTranslationResult, TranslationProtocolError, TranslationQualityError, validateTranslationResult } from "../translation-result"

const bilingual = { targetCode: "cmn", secondaryCode: "eng" } as const
const preserve = { targetCode: "cmn", secondaryCode: "original" } as const
const issueSentence = "Keep code, identifiers, proper nouns and inline formatting as they are."
const chineseProse = "这是一个普通的中文段落，用于检查翻译方向是否正确。"

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

  it("rejects the issue sentence routed to English and accepts its Chinese translation", () => {
    expect(() => parseTranslationResult(`[[readomi:secondary]]\n${issueSentence}`, bilingual, issueSentence)).toThrow(TranslationQualityError)
    expect(parseTranslationResult("[[readomi:primary]]\n保持代码、标识符、专有名词和行内格式原样。", bilingual, issueSentence)).toEqual({ action: "translate", text: "保持代码、标识符、专有名词和行内格式原样。", targetCode: "cmn" })
  })

  it("rejects Chinese prose mislabeled as an English translation", () => {
    expect(() => parseTranslationResult(`[[readomi:secondary]]\n${chineseProse}`, bilingual, chineseProse)).toThrow(TranslationQualityError)
    expect(() => parseTranslationResult("[[readomi:secondary]]\n这是另一个中文段落，译文仍然没有使用英语。", bilingual, chineseProse)).toThrow(TranslationQualityError)
    expect(parseTranslationResult("[[readomi:secondary]]\nThis is a normal Chinese paragraph for checking the translation direction.", bilingual, chineseProse).targetCode).toBe("eng")
  })

  it("rejects copied substantial prose and a Chinese target with no Chinese text", () => {
    expect(() => parseTranslationResult(`[[readomi:primary]]\n${issueSentence}`, bilingual, issueSentence)).toThrow("repeated the source prose")
    expect(() => parseTranslationResult("[[readomi:primary]]\nLeave the code and its identifiers unchanged.", bilingual, issueSentence)).toThrow("did not contain Chinese prose")
    expect(() => parseTranslationResult(`[[readomi:primary]]\n  ${issueSentence.toLowerCase().replace(/[,.]/g, "")}  `, bilingual, issueSentence)).toThrow("repeated the source prose")
  })

  it("validates cache targets as well as fresh protocol responses", () => {
    expect(() => validateTranslationResult("Hello", { action: "translate", text: "Bonjour", targetCode: "fra" }, bilingual)).toThrow(TranslationQualityError)
    expect(() => validateTranslationResult("Hello", { action: "translate", text: "", targetCode: "cmn" }, bilingual)).toThrow(TranslationQualityError)
    expect(() => validateTranslationResult("Hello", { action: "preserve", text: "" }, bilingual)).toThrow(TranslationQualityError)
  })

  it("requires preservation for confidently primary prose in original mode", () => {
    expect(parseTranslationResult("[[readomi:preserve]]", preserve, chineseProse)).toEqual({ action: "preserve", text: "" })
    expect(() => parseTranslationResult("[[readomi:primary]]\n这是改写后的段落。", preserve, chineseProse)).toThrow(TranslationQualityError)
    expect(() => parseTranslationResult("[[readomi:preserve]]", preserve, issueSentence)).toThrow(TranslationQualityError)
  })

  it.each([
    ["Readomi Magpie GitHub", "Readomi Magpie GitHub"],
    ["Hello", "Hello"],
    ["`return response.json()` {{0}}", "`return response.json()` {{0}}"],
    ["这是包含日本語かな的中文段落，应由模型判断方向。", "Mixed text"],
  ])("does not reject preserved spelling or uncertain source languages: %s", (source, translated) => {
    expect(() => parseTranslationResult(`[[readomi:primary]]\n${translated}`, bilingual, source)).not.toThrow()
  })

  it("allows mixed proper names and protected atoms inside a translation", () => {
    const source = "The output is from Readomi and it is available on GitHub as {{0}}."
    expect(() => parseTranslationResult("[[readomi:primary]]\n输出来自 Readomi，并可在 GitHub 上以 {{0}} 的形式获取。", bilingual, source)).not.toThrow()
  })

  it("rejects newly leaked source wrappers and internal rule headings", () => {
    expect(() => parseTranslationResult("[[readomi:primary]]\n<readomi_source_0>\n保持代码原样。\n</readomi_source_0>", bilingual, issueSentence)).toThrow(TranslationQualityError)
    expect(() => parseTranslationResult("[[readomi:primary]]\n## Translation Direction Rules\n保持代码原样。", bilingual, issueSentence)).toThrow(TranslationQualityError)
    expect(() => parseTranslationResult("[[readomi:primary]]\n[[readomi:primary]]\n保持代码原样。", bilingual, issueSentence)).toThrow(TranslationQualityError)
    expect(() => parseTranslationResult("[[readomi:primary]]\nTranslate to the automatic target language determined by the Translation Direction Rules:\n保持代码原样。", bilingual, issueSentence)).toThrow(TranslationQualityError)
    expect(() => parseTranslationResult("[[readomi:primary]]\nTranslate the following source text, following the required direction for each segment:\n保持代码原样。", bilingual, issueSentence)).toThrow(TranslationQualityError)
  })

  it("does not treat source quotations, code examples or custom headings as leaked instructions", () => {
    const source = "The documentation includes `<readomi_source_0>` and `[[readomi:primary]]` as examples."
    expect(() => parseTranslationResult("[[readomi:primary]]\n文档使用 `<readomi_source_0>` 和 `[[readomi:primary]]` 作为示例。", bilingual, source)).not.toThrow()
    expect(() => parseTranslationResult("[[readomi:primary]]\n## My Custom Header\n保持代码原样。", bilingual, issueSentence)).not.toThrow()
    expect(() => parseTranslationResult("[[readomi:primary]]\n## Translation Direction Rules\n这是页面中的标题。", bilingual, "## Translation Direction Rules\nThis is the heading on the original page.")).not.toThrow()
    expect(() => parseTranslationResult("[[readomi:primary]]\n旧提示词以“Translate to the automatic target language determined by the Translation Direction Rules:”开头。", bilingual, "The old prompt starts with 'Translate to the automatic target language determined by the Translation Direction Rules:' in the documentation.")).not.toThrow()
    expect(() => parseTranslationResult("[[readomi:primary]]\n文档中的 `<readomi_source_0>`。\n<readomi_source_1>\n这里是译文。", bilingual, "The source example includes `<readomi_source_0>` and the translated paragraph follows it.")).toThrow(TranslationQualityError)
  })

  it("marks quality failures as retryable protocol errors", () => {
    try {
      parseTranslationResult(`[[readomi:primary]]\n${issueSentence}`, bilingual, issueSentence)
      expect.fail("Expected a quality failure")
    }
    catch (error) {
      expect(error).toBeInstanceOf(TranslationProtocolError)
      expect(error).toBeInstanceOf(TranslationQualityError)
      expect((error as Error).name).toBe("TranslationQualityError")
      expect(getRequestErrorMeta(error).isRetryable).toBe(true)
    }
  })

  it("suppresses known wrong streaming routes but waits for final text before textual checks", () => {
    expect(parseTranslationPartial("[[readomi:secondary]]\nKeep code", bilingual, issueSentence)).toBeUndefined()
    expect(parseTranslationPartial("[[readomi:primary]]\nReadomi", bilingual, issueSentence)).toEqual({ action: "translate", text: "Readomi", targetCode: "cmn" })
    expect(parseTranslationPartial("[[readomi:primary]]\n", preserve, chineseProse)).toBeUndefined()
    expect(parseTranslationPartial("[[readomi:secondary]]\n英文", bilingual, chineseProse)).toEqual({ action: "translate", text: "英文", targetCode: "eng" })
  })
})
