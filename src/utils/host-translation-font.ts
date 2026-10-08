import type { TranslationFont } from "@/types/config/translation-font"
import { TRANSLATION_FONT_FAMILIES } from "@/types/config/translation-font"

export const PAGE_TRANSLATION_FONT_VARIABLE = "--readomi-page-translation-font"

type StyleRoot = Document | ShadowRoot
const roots = new Set<WeakRef<StyleRoot>>()
const tracked = new WeakSet<StyleRoot>()
let current: TranslationFont = "sans"

function apply(root: StyleRoot) {
  const target = root instanceof Document ? root.documentElement : root.host as HTMLElement
  target.style.setProperty(PAGE_TRANSLATION_FONT_VARIABLE, TRANSLATION_FONT_FAMILIES[current])
}

/** Include site shadow roots and streaming previews created after a font change. */
export function trackHostTranslationFontRoot(root: StyleRoot) {
  if (!tracked.has(root)) {
    tracked.add(root)
    roots.add(new WeakRef(root))
  }
  apply(root)
}

/** Restyle current and pending translations without another translation request. */
export function setHostTranslationFont(font: TranslationFont) {
  current = font
  for (const reference of roots) {
    const root = reference.deref()
    if (root)
      apply(root)
    else
      roots.delete(reference)
  }
}
