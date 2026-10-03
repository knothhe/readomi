import type { Config } from "@/types/config/config"
import { ISO6393_TO_6391 } from "@/definitions"
import { getEffectiveSiteRule } from "@/utils/site-rules/effective"

const LETTER_RE = /\p{L}/u
const PURE_HANDLE_RE = /^@\S+$/u

/**
 * Paragraphs not worth a request: text without a single letter (numbers,
 * prices, dates, symbols) and single characters such as icons or bullets.
 * Code blocks never get here; the DOM walk skips <pre>.
 */
export function shouldFilterSmallParagraph(text: string, config?: Config): boolean {
  const trimmed = text.trim()
  if (PURE_HANDLE_RE.test(trimmed) || !LETTER_RE.test(trimmed))
    return true
  const rule = config ? getEffectiveSiteRule(config, window.location.href) : undefined
  if ([...trimmed].length < (rule?.minCharacters ?? 2))
    return true
  if ((rule?.minWords ?? 0) > 0) {
    const locale = config?.language.sourceCode === "auto" ? undefined : ISO6393_TO_6391[config?.language.sourceCode ?? "eng"]
    const words = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(trimmed)].filter(segment => segment.isWordLike).length
    if (words < rule!.minWords!)
      return true
  }
  return false
}
