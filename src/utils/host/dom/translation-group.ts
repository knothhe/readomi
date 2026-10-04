import type { Config } from "@/types/config/config"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { getEffectiveSiteRule } from "@/utils/site-rules/effective"
import { getEffectiveTagSet, isDontWalkIntoButTranslateAsChildElement, isHTMLElement, isSiteRuleExcludedElement, isTranslatedWrapperNode } from "./filter"

export interface TranslationGroup {
  container: HTMLElement
  sources: HTMLElement[]
  placement: "append" | "after"
  slot?: string
}

const wrapperOwners = new WeakMap<HTMLElement, HTMLElement>()

export function registerTranslationGroupWrapper(wrapper: HTMLElement, container: HTMLElement): void {
  wrapperOwners.set(wrapper, container)
}

export function getTranslationGroupOwner(element: Element): HTMLElement | undefined {
  const wrapper = element.closest<HTMLElement>(`.${CONTENT_WRAPPER_CLASS}`)
  return wrapper ? wrapperOwners.get(wrapper) : undefined
}

/** Group-owned display changes must not make the original sources disappear from the rule. */
function isSourceAllowed(source: HTMLElement, container: HTMLElement, config: Config): boolean {
  let current: HTMLElement | null = source
  while (current && current !== container) {
    if (isTranslatedWrapperNode(current) || current.hidden || current.getAttribute("aria-hidden") === "true"
      || getEffectiveTagSet(config, "dontWalkTags").has(current.tagName)
      || isDontWalkIntoButTranslateAsChildElement(current, config)
      || isSiteRuleExcludedElement(current, config)) {
      return false
    }
    current = current.parentElement
  }
  return current === container
}

/** The container owns one request; only explicitly selected light-DOM descendants supply text. */
export function getTranslationGroup(element: Element, config: Config): TranslationGroup | undefined {
  if (!isHTMLElement(element) || isTranslatedWrapperNode(element))
    return undefined
  const rules = getEffectiveSiteRule(config, element.ownerDocument.location?.href ?? window.location.href).translationGroups
  let rule: (typeof rules)[number] | undefined
  for (let index = rules.length - 1; index >= 0; index--) {
    if (element.matches(rules[index].containerSelector)) {
      rule = rules[index]
      break
    }
  }
  if (!rule || !rule.sourceSelectors.length)
    return undefined
  const candidates = [...new Set(rule.sourceSelectors.flatMap(selector =>
    [...element.querySelectorAll<HTMLElement>(selector)].filter(source => isHTMLElement(source) && isSourceAllowed(source, element, config)),
  ))]
  // Overlapping selectors never send a paragraph twice. A selected outer source
  // already contains its selected descendants, so it owns their text.
  const sources = candidates.filter(source => !candidates.some(other => other !== source && other.contains(source)))
  return { container: element, sources, placement: rule.placement ?? "append", slot: rule.slot }
}

export function findTranslationGroup(element: Element, config: Config): TranslationGroup | undefined {
  if (!getEffectiveSiteRule(config, element.ownerDocument.location?.href ?? window.location.href).translationGroups.length)
    return undefined
  const owner = getTranslationGroupOwner(element)
  if (owner)
    return getTranslationGroup(owner, config)
  let current: Element | null = element
  while (current) {
    const group = getTranslationGroup(current, config)
    if (group)
      return group
    const root = current.getRootNode()
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  }
  return undefined
}
