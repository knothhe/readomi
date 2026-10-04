import { describe, expect, it } from "vitest"
import { getSecondaryLanguage, isPrimaryLanguagePreserved, isSameLanguageFamily } from "../language-policy"

describe("automatic translation language policy", () => {
  it("defaults the second language of older configurations to English", () => {
    expect(getSecondaryLanguage({ targetCode: "cmn" })).toBe("eng")
    expect(isPrimaryLanguagePreserved({ targetCode: "cmn" })).toBe(false)
  })

  it("preserves the primary language for the original choice and same-family choices", () => {
    expect(isPrimaryLanguagePreserved({ targetCode: "cmn", secondaryCode: "original" })).toBe(true)
    expect(isPrimaryLanguagePreserved({ targetCode: "eng", secondaryCode: "eng" })).toBe(true)
    expect(isPrimaryLanguagePreserved({ targetCode: "cmn", secondaryCode: "cmn-Hant" })).toBe(true)
    expect(isPrimaryLanguagePreserved({ targetCode: "cmn-Hant", secondaryCode: "cmn" })).toBe(true)
  })

  it("does not group Japanese or Cantonese with Mandarin because they use Han characters", () => {
    expect(isSameLanguageFamily("cmn", "jpn")).toBe(false)
    expect(isSameLanguageFamily("cmn", "yue")).toBe(false)
    expect(isPrimaryLanguagePreserved({ targetCode: "cmn", secondaryCode: "jpn" })).toBe(false)
  })
})
