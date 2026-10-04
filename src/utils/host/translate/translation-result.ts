import type { LangCodeISO6393 } from "@/definitions"
import type { LanguagePolicyConfig } from "@/utils/language-policy"
import { getSecondaryLanguage, isPrimaryLanguagePreserved } from "@/utils/language-policy"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { getTranslationProse, inferTranslationDirection, inferTranslationSourceLanguage } from "./translation-direction"

export const TRANSLATION_PROTOCOL_VERSION = "automatic-language-v2"
export const AUTOMATIC_TARGET_LANGUAGE = "the automatic target language determined by the Translation Direction Rules"

export interface TranslationResult {
  action: "translate" | "preserve"
  text: string
  targetCode?: LangCodeISO6393
}

type TranslationRoute = "primary" | "secondary" | "preserve"
const HEADER_RE = /^\[\[readomi:(primary|secondary|preserve)\]\](?:\r?\n|$)/

export class TranslationProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TranslationProtocolError"
    attachRequestErrorMeta(this, { isRetryable: true })
  }
}

export class TranslationQualityError extends TranslationProtocolError {
  constructor(message: string) {
    super(message)
    this.name = "TranslationQualityError"
  }
}

function targetForRoute(route: TranslationRoute, language: LanguagePolicyConfig): LangCodeISO6393 | undefined {
  if (route === "primary")
    return language.targetCode
  if (route === "secondary") {
    const secondary = getSecondaryLanguage(language)
    if (secondary === "original" || isPrimaryLanguagePreserved(language))
      throw new TranslationProtocolError("The translation response selected an unavailable secondary language")
    return secondary
  }
  if (!isPrimaryLanguagePreserved(language))
    throw new TranslationProtocolError("The translation response preserved text despite an active secondary language")
  return undefined
}

/** A route belongs to each translation unit, including each segment of a batch. */
export function parseTranslationResult(raw: string, language: LanguagePolicyConfig, source?: string): TranslationResult {
  const value = raw.trim()
  const header = value.match(HEADER_RE)
  if (!header)
    throw new TranslationProtocolError("The translation response is missing its language header")
  const route = header[1] as TranslationRoute
  const targetCode = targetForRoute(route, language)
  const text = value.slice(header[0].length).trim()
  if (route === "preserve") {
    if (text)
      throw new TranslationProtocolError("A preserved translation must not contain replacement text")
    const result: TranslationResult = { action: "preserve", text: "" }
    if (source !== undefined)
      validateTranslationResult(source, result, language)
    return result
  }
  if (!text)
    throw new TranslationProtocolError("The translation response has no translated text")
  const result: TranslationResult = { action: "translate", text, targetCode }
  if (source !== undefined)
    validateTranslationResult(source, result, language)
  return result
}

function validateTranslationRoute(source: string, result: TranslationResult, language: LanguagePolicyConfig): void {
  const expected = inferTranslationDirection(source, language)
  if (expected && (result.action !== (expected.route === "preserve" ? "preserve" : "translate") || result.targetCode !== expected.targetCode))
    throw new TranslationQualityError("The translation response selected the wrong language direction")
}

function normalizedProse(text: string): string {
  return getTranslationProse(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase()
}

function hasLeakedInstructions(source: string, text: string): boolean {
  // A page may document the protocol or literally quote a source boundary.
  // Reject newly emitted wrappers, not strings already present in its content.
  const tokens = text.match(/<\/?readomi_source_\d+>|\[\[readomi:(?:primary|secondary|preserve)\]\]|^## (?:Translation Direction Rules|Required Response Format|Protected Placeholder Rules|Source Data Rules|Required Segment Directions|Correct the Invalid Translation Response)(?=[ \t]*\r?$)/gm) ?? []
  const counts = new Map<string, number>()
  for (const token of tokens)
    counts.set(token, (counts.get(token) ?? 0) + 1)
  for (const [token, count] of counts) {
    if (count > source.split(token).length - 1)
      return true
  }
  const generatedInstructions = [
    `Translate to ${AUTOMATIC_TARGET_LANGUAGE}`,
    `You are a professional ${AUTOMATIC_TARGET_LANGUAGE} native translator`,
    "Translate the following source text, following the required direction for each segment:",
    "Translate each source segment into the language required by the Translation Direction Rules and Required Segment Directions below.",
  ]
  for (const instruction of generatedInstructions) {
    if (text.split(instruction).length > source.split(instruction).length)
      return true
  }
  return false
}

/** Validate completed live responses and cached records before accepting them. */
export function validateTranslationResult(source: string, result: TranslationResult, language: LanguagePolicyConfig): void {
  validateTranslationRoute(source, result, language)
  if (result.action === "preserve") {
    if (!isPrimaryLanguagePreserved(language) || result.text || result.targetCode !== undefined)
      throw new TranslationQualityError("The translation response cannot preserve this text")
    return
  }
  const secondary = getSecondaryLanguage(language)
  if (!result.text.trim() || (result.targetCode !== language.targetCode && (isPrimaryLanguagePreserved(language) || result.targetCode !== secondary)))
    throw new TranslationQualityError("The translation response has an invalid target language or no translated text")
  if (hasLeakedInstructions(source, result.text))
    throw new TranslationQualityError("The translation response included internal instructions or source boundaries")

  // Short names, code, labels and languages we cannot identify locally must not
  // fail because their valid translation keeps the same spelling or script.
  if (!inferTranslationSourceLanguage(source))
    return
  if (normalizedProse(source) === normalizedProse(result.text))
    throw new TranslationQualityError("The translation response repeated the source prose")
  const prose = getTranslationProse(result.text)
  const hanCount = (prose.match(/\p{Script=Han}/gu) ?? []).length
  const latinCount = (prose.match(/\p{Script=Latin}/gu) ?? []).length
  if ((result.targetCode === "cmn" || result.targetCode === "cmn-Hant") && hanCount === 0)
    throw new TranslationQualityError("The translation response did not contain Chinese prose")
  if (result.targetCode === "eng" && hanCount >= 8 && hanCount > latinCount && inferTranslationSourceLanguage(result.text) !== "eng")
    throw new TranslationQualityError("The translation response did not contain English prose")
}

/** Buffer the header until it is complete; protocol text never reaches the reader. */
export function parseTranslationPartial(raw: string, language: LanguagePolicyConfig, source?: string): TranslationResult | undefined {
  const value = raw.trimStart()
  // An end-of-string match could still be a header split before its newline.
  const header = value.match(HEADER_RE)
  if (!header || !header[0].endsWith("\n"))
    return undefined
  const route = header[1] as TranslationRoute
  try {
    const targetCode = targetForRoute(route, language)
    const result: TranslationResult = route === "preserve"
      ? { action: "preserve", text: "" }
      : { action: "translate", text: value.slice(header[0].length), targetCode }
    if (source !== undefined)
      validateTranslationRoute(source, result, language)
    return result
  }
  catch {
    // Validate the completed response outside the stream transport so a bad
    // model format can retry without being treated as a partial network error.
    return undefined
  }
}

export function displayTranslationResult(result: TranslationResult): string {
  return result.action === "preserve" ? "" : result.text
}
