import type { LangCodeISO6393 } from "@/definitions"
import type { LanguagePolicyConfig } from "@/utils/language-policy"
import { getSecondaryLanguage, isPrimaryLanguagePreserved, isSameLanguageFamily } from "@/utils/language-policy"

export interface InferredTranslationDirection {
  route: "primary" | "secondary" | "preserve"
  targetCode?: LangCodeISO6393
}

// Script alone cannot identify English. Require ordinary lowercase prose and
// several function words, so identifiers, names and short labels stay unknown.
const ENGLISH_FUNCTION_WORDS = new Set("a an the and or but as at by for from in into of on to with is are was were be been being this that these those it its they their them we our you your he his she her not do does did can could will would should may must if then than when where which who how what have has had".split(" "))
const ENGLISH_STRONG_WORDS = new Set("the but from with is are was were been being this that these those its they their them our you your his she her does did could will would should which who how what have has had".split(" "))
const MANDARIN_PROSE_RE = /[的了是在这這那和与與为為将將请請从從对對您我们們它]/g

function stripFencedCode(text: string): string {
  const prose: string[] = []
  let fence: string | undefined
  for (const line of text.split(/\r?\n/)) {
    const value = line.trimStart()
    if (fence) {
      if (value.startsWith(fence) && new RegExp(`^${fence[0]}+$`).test(value.trim()))
        fence = undefined
      continue
    }
    const opening = value.match(/^(`{3,}|~{3,})/)
    if (opening)
      fence = opening[1]
    else
      prose.push(line)
  }
  return prose.join("\n")
}

/** Ignore preserved atoms and code when judging the language of the prose. */
export function getTranslationProse(text: string): string {
  return stripFencedCode(text)
    .replace(/`+[^`]*`+/g, " ")
    .replace(/\{\{\d+\}\}/g, " ")
    .replace(/https?:\/\/[^\s<>]+/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/\b[\w.$]+\b/g, word => /[_$]/.test(word) ? " " : word)
    .replace(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, " ")
}

/** Deliberately limited to languages we can recognize with strong local evidence. */
export function inferTranslationSourceLanguage(source: string): "cmn" | "eng" | undefined {
  const prose = getTranslationProse(source)
  const hanCount = (prose.match(/\p{Script=Han}/gu) ?? []).length
  const latinCount = (prose.match(/\p{Script=Latin}/gu) ?? []).length
  const letterCount = (prose.match(/\p{L}/gu) ?? []).length
  // Japanese and Korean can contain many Han characters. Let the model handle
  // them even if the sentence also contains familiar Chinese function words.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(prose))
    return undefined

  const mandarinProseCount = new Set(prose.match(MANDARIN_PROSE_RE) ?? []).size
  const lettersWithoutNames = (prose.replace(/\b[A-Z][A-Za-z0-9]+\b/g, " ").match(/\p{L}/gu) ?? []).length
  if (hanCount >= 8 && hanCount / Math.max(1, lettersWithoutNames) >= 0.6 && mandarinProseCount >= 2)
    return "cmn"

  // Non-ASCII Latin text is often another language. Even small accents are a
  // reason to avoid forcing an English direction without a language detector.
  if ((prose.match(/\p{Script=Latin}/gu) ?? []).some(letter => !/[A-Z]/i.test(letter)))
    return undefined
  const words = prose.match(/\b[A-Z]+(?:'[A-Z]+)?\b/gi) ?? []
  const lowercaseWords = words.filter(word => /^[a-z]+(?:'[a-z]+)?$/.test(word))
  const functionWords = lowercaseWords.filter(word => ENGLISH_FUNCTION_WORDS.has(word))
  if (words.length >= 6
    && lowercaseWords.length >= 4
    && lowercaseWords.length / words.length >= 0.5
    && functionWords.length >= 3
    && new Set(functionWords).size >= 2
    && functionWords.some(word => ENGLISH_STRONG_WORDS.has(word))
    && latinCount / Math.max(1, letterCount) >= 0.85) {
    return "eng"
  }
  return undefined
}

/** Unknown languages and ambiguous short text keep the model's automatic route. */
export function inferTranslationDirection(source: string, language: LanguagePolicyConfig): InferredTranslationDirection | undefined {
  const sourceLanguage = inferTranslationSourceLanguage(source)
  if (!sourceLanguage)
    return undefined
  if (!isSameLanguageFamily(sourceLanguage, language.targetCode))
    return { route: "primary", targetCode: language.targetCode }
  if (isPrimaryLanguagePreserved(language))
    return { route: "preserve" }
  const secondary = getSecondaryLanguage(language)
  return secondary === "original" ? { route: "preserve" } : { route: "secondary", targetCode: secondary }
}
