import { describe, expect, it } from "vitest"
import { inferTranslationDirection } from "../translation-direction"

const bilingual = { targetCode: "cmn", secondaryCode: "eng" } as const
const chinese = "这是一个普通的中文段落，用于检查翻译方向是否正确。"
const english = "Keep code, identifiers, proper nouns and inline formatting as they are."

describe("conservative translation direction inference", () => {
  it("identifies ordinary English prose, including source text written as an instruction", () => {
    expect(inferTranslationDirection(english, bilingual)).toEqual({ route: "primary", targetCode: "cmn" })
    expect(inferTranslationDirection("Open the settings page and choose your preferred language.", bilingual)).toEqual({ route: "primary", targetCode: "cmn" })
  })

  it("routes Mandarin prose to the secondary language and treats both scripts as a family", () => {
    expect(inferTranslationDirection(chinese, bilingual)).toEqual({ route: "secondary", targetCode: "eng" })
    expect(inferTranslationDirection("這是一個普通的中文段落，用於檢查翻譯方向是否正確。", { targetCode: "cmn-Hant", secondaryCode: "eng" })).toEqual({ route: "secondary", targetCode: "eng" })
    expect(inferTranslationDirection(chinese, { targetCode: "cmn", secondaryCode: "cmn-Hant" })).toEqual({ route: "preserve" })
  })

  it("preserves primary prose when the secondary preference is original", () => {
    expect(inferTranslationDirection(chinese, { targetCode: "cmn", secondaryCode: "original" })).toEqual({ route: "preserve" })
    expect(inferTranslationDirection(english, { targetCode: "eng", secondaryCode: "original" })).toEqual({ route: "preserve" })
    expect(inferTranslationDirection(chinese, { targetCode: "eng", secondaryCode: "original" })).toEqual({ route: "primary", targetCode: "eng" })
  })

  it("ignores preserved inline atoms, code and names in ordinary prose", () => {
    expect(inferTranslationDirection("The result is `getUserData()` and the value comes from {{0}}.", bilingual)).toEqual({ route: "primary", targetCode: "cmn" })
    expect(inferTranslationDirection("这是 Readomi 的翻译结果，请保持 GitHub 的名称不变。", bilingual)).toEqual({ route: "secondary", targetCode: "eng" })
  })

  it.each([
    "GitHub Readomi Magpie OpenAI",
    "The United States of America and New York City",
    "Hello world",
    "更新设置",
    "中华人民共和国北京市海淀区",
    "const response = await fetch(url); return response.json()",
    "`This is the source and the target language.` {{0}}",
    "```js\nconst message = 'This is the source and the target language.'\n```",
    "Le texte est dans la documentation et il doit rester lisible.",
    "La documentación es para los usuarios de la aplicación.",
    "これは中文和日本語が混在する文章です。",
    "这是一个包含日本語かな的中文段落，不应强制认定语言。",
    "这是一个包含한국어的中文段落，不应强制认定语言。",
  ])("leaves ambiguous names, code, other languages and mixed scripts to the model: %s", (source) => {
    expect(inferTranslationDirection(source, bilingual)).toBeUndefined()
  })
})
