import type { LangCodeISO6393 } from "@/definitions"

export type SecondaryLanguage = LangCodeISO6393 | "original"

/** targetCode remains the primary language so older saved preferences keep their meaning. */
export interface LanguagePolicyConfig {
  targetCode: LangCodeISO6393
  secondaryCode?: SecondaryLanguage
}

export function getSecondaryLanguage(language: LanguagePolicyConfig): SecondaryLanguage {
  return language.secondaryCode ?? "eng"
}

/** Script variants of Mandarin are one source-language family; Han characters alone are not. */
export function isSameLanguageFamily(first: LangCodeISO6393, second: LangCodeISO6393): boolean {
  if (first === second)
    return true
  return (first === "cmn" || first === "cmn-Hant") && (second === "cmn" || second === "cmn-Hant")
}

export function isPrimaryLanguagePreserved(language: LanguagePolicyConfig): boolean {
  const secondary = getSecondaryLanguage(language)
  return secondary === "original" || isSameLanguageFamily(language.targetCode, secondary)
}
