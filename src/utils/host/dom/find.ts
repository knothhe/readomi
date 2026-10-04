import type { Config } from "@/types/config/config"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { getEffectiveTagSet, isDontWalkIntoAndDontTranslateAsChildElement, isHTMLElement, isShallowInlineHTMLElement, isSiteRuleForceBlockNodeElement, isSiteRuleForceInlineNodeElement, isTranslatedContentNode, isTranslatedWrapperNode, isWalkBlockedElement } from "./filter"
import { smashTruncationStyle } from "./style"
import { findTranslationGroup, getTranslationGroupOwner } from "./translation-group"

function isInlineTraversalElement(element: HTMLElement, config?: Config): boolean {
  if (config) {
    if (getEffectiveTagSet(config, "forceBlockTags").has(element.tagName) || isSiteRuleForceBlockNodeElement(element, config))
      return false
    if (isSiteRuleForceInlineNodeElement(element, config))
      return true
  }
  return isShallowInlineHTMLElement(element, undefined, config)
}

export function findNearestAncestorBlockNodeFor(element: Element, config?: Config) {
  if (config) {
    const group = findTranslationGroup(element, config)
    if (group) {
      if (getTranslationGroupOwner(element))
        return group.container
      let current: Element | null = element
      let blocked = false
      while (current && current !== group.container) {
        // A site's explicitly inline overlay can locate its readable siblings;
        // excluded metadata, media and action subtrees remain hover boundaries.
        if (isHTMLElement(current) && isWalkBlockedElement(current, config) && !isSiteRuleForceInlineNodeElement(current, config)) {
          blocked = true
          break
        }
        const root = current.getRootNode()
        current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
      }
      if (!blocked)
        return group.container
    }
  }
  const startElement = element.closest(`.${CONTENT_WRAPPER_CLASS}`)?.parentElement || element
  let currentNode = startElement
  while (currentNode && currentNode.parentElement && isHTMLElement(currentNode) && isInlineTraversalElement(currentNode, config)) {
    currentNode = currentNode.parentElement
  }
  return currentNode
}

export function deepQueryTopLevelSelector(element: HTMLElement | ShadowRoot | Document, selectorFn: (element: HTMLElement) => boolean): HTMLElement[] {
  if (element instanceof Document) {
    return deepQueryTopLevelSelector(element.body, selectorFn)
  }

  const result: HTMLElement[] = []
  if (element instanceof ShadowRoot) {
    for (const child of element.children) {
      if (isHTMLElement(child)) {
        result.push(...deepQueryTopLevelSelector(child, selectorFn))
      }
    }
    return result
  }

  if (selectorFn(element)) {
    return [element]
  }

  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) {
      if (isHTMLElement(child)) {
        result.push(...deepQueryTopLevelSelector(child, selectorFn))
      }
    }
  }

  for (const child of element.children) {
    if (isHTMLElement(child)) {
      result.push(...deepQueryTopLevelSelector(child, selectorFn))
    }
  }

  return result
}

export function unwrapDeepestOnlyHTMLChild(element: HTMLElement, config?: Config) {
  let currentElement = element
  while (currentElement) {
    smashTruncationStyle(currentElement)

    const shouldKeepNode = (child: ChildNode) => {
      if (!child.textContent?.trim())
        return false
      if (child.nodeType === Node.TEXT_NODE)
        return true
      return isHTMLElement(child) && !isDontWalkIntoAndDontTranslateAsChildElement(child, config)
    }

    const effectiveChildNodes = [...currentElement.childNodes].filter(shouldKeepNode)
    const effectiveChildren = effectiveChildNodes.filter(child => child.nodeType === Node.ELEMENT_NODE)

    // Only have one HTML child and no Text Child
    if (!(effectiveChildren.length === 1 && effectiveChildNodes.length === 1))
      break

    const onlyChildElement = effectiveChildren[0]
    if (!isHTMLElement(onlyChildElement))
      break

    currentElement = onlyChildElement
  }

  return currentElement
}

/**
 * Find the nearest translated content wrapper ancestor
 * @param node - The node should be a translated content node
 */
export function findTranslatedContentWrapper(node: HTMLElement): HTMLElement | null {
  if (!isTranslatedContentNode(node))
    return null

  let currentElement = node.parentElement
  while (currentElement) {
    if (isTranslatedWrapperNode(currentElement)) {
      return currentElement
    }
    currentElement = currentElement.parentElement
  }
  return null
}
