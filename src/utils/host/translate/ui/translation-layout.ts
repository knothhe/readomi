import type { Config } from "@/types/config/config"
import type { TransNode } from "@/types/dom"
import { isHTMLElement, isNaturalBlockTransNode, isNaturalInlineTransNode } from "@/utils/host/dom/filter"
import { matchesSiteRuleSelector } from "@/utils/host/dom/site-rule-matching"
import { getEffectiveSiteRule } from "@/utils/site-rules/effective"
import { isForceInlineTranslation } from "./translation-utils"

export type TranslationLayout = "block" | "inline"
const pendingLayouts = new WeakMap<HTMLElement, TranslationLayout | null>()
const PARAGRAPH_LAYOUT_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "FIGCAPTION"])

/** A whole paragraph keeps its layout when single-child unwrapping reaches an inline span. */
function paragraphLayoutSource(target: TransNode, sources: readonly TransNode[], config: Config): TransNode {
  const source = sources.length === 1 ? sources[0] : undefined
  if (!source || source === target || !isHTMLElement(source) || !source.contains(target))
    return target

  let element = isHTMLElement(target) ? target : target.parentElement
  while (element) {
    if (PARAGRAPH_LAYOUT_TAGS.has(element.tagName) && isNaturalBlockTransNode(element))
      return element
    // Neutral spans can wrap prose. Controls and flex containers keep their
    // own inline layout even when a paragraph surrounds the entire control.
    if (window.getComputedStyle(element).display.includes("flex")
      || (element.tagName !== "SPAN" && isForceInlineTranslation(element, config))) {
      return target
    }
    if (element === source)
      break
    element = element.parentElement
  }
  return target
}

/** Resolve once per translation group, before a stream or the final DOM writes. */
export function resolveTranslationLayout(
  target: TransNode,
  forceBlock: boolean,
  config: Config,
  sources: readonly TransNode[] = [target],
): TranslationLayout | null {
  const rule = getEffectiveSiteRule(config, window.location.href)
  const matches = (selector: string | null) => selector !== null && sources.some((source) => {
    const element = isHTMLElement(source) ? source : source.parentElement
    return !!element && matchesSiteRuleSelector(element, selector)
  })
  if (matches(rule.forceBlockStyleSelector))
    return "block"
  if (matches(rule.forceInlineStyleSelector))
    return "inline"
  // Insertion and layout have different sources: preserve complete semantic
  // paragraphs, while partial groups and generic containers keep target layout.
  const layoutSource = paragraphLayoutSource(target, sources, config)
  if (isForceInlineTranslation(layoutSource, config))
    return "inline"
  if (forceBlock)
    return "block"
  if (isNaturalInlineTransNode(layoutSource))
    return "inline"
  return isNaturalBlockTransNode(layoutSource) ? "block" : null
}

// The request contract stays shared with subtitles and translation quality.
// Its typography container also hands this group's resolved layout to hover.
export function setPendingTranslationLayout(element: HTMLElement | undefined, layout: TranslationLayout | null): void {
  if (element)
    pendingLayouts.set(element, layout)
}

export function getPendingTranslationLayout(element: HTMLElement): TranslationLayout | null | undefined {
  return pendingLayouts.get(element)
}
