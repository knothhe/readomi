import type { LangCodeISO6393 } from "@/definitions"
import type { LanguagePolicyConfig } from "@/utils/language-policy"
import { getSecondaryLanguage, isPrimaryLanguagePreserved } from "@/utils/language-policy"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"

export const TRANSLATION_PROTOCOL_VERSION = "automatic-language-v1"
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
export function parseTranslationResult(raw: string, language: LanguagePolicyConfig): TranslationResult {
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
    return { action: "preserve", text: "" }
  }
  if (!text)
    throw new TranslationProtocolError("The translation response has no translated text")
  return { action: "translate", text, targetCode }
}

/** Buffer the header until it is complete; protocol text never reaches the reader. */
export function parseTranslationPartial(raw: string, language: LanguagePolicyConfig): TranslationResult | undefined {
  const value = raw.trimStart()
  // An end-of-string match could still be a header split before its newline.
  const header = value.match(HEADER_RE)
  if (!header || !header[0].endsWith("\n"))
    return undefined
  const route = header[1] as TranslationRoute
  try {
    const targetCode = targetForRoute(route, language)
    if (route === "preserve")
      return { action: "preserve", text: "" }
    return { action: "translate", text: value.slice(header[0].length), targetCode }
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
