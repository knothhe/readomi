import type { Config } from "@/types/config/config"
import type { TransNode } from "@/types/dom"
import { isHTMLElement, isNaturalBlockTransNode, isNaturalInlineTransNode } from "@/utils/host/dom/filter"
import { matchesSiteRuleSelector } from "@/utils/host/dom/site-rule-matching"
import { getEffectiveSiteRule } from "@/utils/site-rules/effective"
import { isForceInlineTranslation } from "./translation-utils"

export type TranslationLayout = "block" | "inline"
const pendingLayouts = new WeakMap<HTMLElement, TranslationLayout | null>()

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
  // Natural layout belongs to the insertion target after unwrapping. A site's
  // explicit style selectors above can still keep the original paragraph block.
  if (isForceInlineTranslation(target, config))
    return "inline"
  if (forceBlock)
    return "block"
  if (isNaturalInlineTransNode(target))
    return "inline"
  return isNaturalBlockTransNode(target) ? "block" : null
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
