import { MAX_CUSTOM_CSS_LENGTH } from "@/types/config/translate"
import { logger } from "@/utils/logger"

/**
 * Site adaptation CSS only changes layout. Reject entire fragments that can
 * load resources or use legacy executable CSS; CSS is injected via textContent
 * or CSSStyleSheet, never interpreted as HTML. Decoding is for inspection only:
 * preserve the real stylesheet text, including strings and selectors.
 */
export function sanitizeSiteRuleCss(css: string): string | null {
  if (!css.trim())
    return null
  const inspected = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([\da-f]{1,6})\s?|\\([^\r\n])/gi, (_match, hex: string | undefined, character: string | undefined) => {
      if (!hex)
        return character ?? ""
      const value = Number.parseInt(hex, 16)
      return String.fromCodePoint(value > 0 && value <= 0x10FFFF ? value : 0xFFFD)
    })
  if (css.length > MAX_CUSTOM_CSS_LENGTH
    || /@import\b|(?:url|src|image|image-set|-webkit-image-set|expression)\s*\(|(?:-moz-binding|behavior)\s*:/i.test(inspected)) {
    logger.warn("[site-rules] Unsafe or oversized CSS fragment dropped")
    return null
  }
  return css
}
