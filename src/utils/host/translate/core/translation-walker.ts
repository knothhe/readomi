import type { PageTranslationRequest } from "../stream-request"
import type { Config } from "@/types/config/config"
import {
  BLOCK_ATTRIBUTE,
  CONTENT_WRAPPER_CLASS,
  PARAGRAPH_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "../../../constants/dom-labels"
import { isBlockTransNode, isHTMLElement, isNaturalBlockTransNode, isSiteRuleForceBlockStyleElement, isTextNode, isTranslatedWrapperNode, isTransNode } from "../../dom/filter"
import { deepQueryTopLevelSelector } from "../../dom/find"
import { removeTranslatedWrapperWithRestore } from "../dom/translation-cleanup"
import { translateNodes } from "./translation-modes"

/**
 * Translates the walked element and its walked descendants. After `signal`
 * aborts, the translation no longer changes the page.
 */
export async function translateWalkedElement(
  element: HTMLElement,
  walkId: string,
  config: Config,
  toggle: boolean = false,
  signal?: AbortSignal,
  translateRequest?: PageTranslationRequest,
): Promise<void> {
  if (signal?.aborted)
    return

  if (!toggle && element.querySelector(`.${CONTENT_WRAPPER_CLASS}`))
    return

  // if the walkId is not the same, return
  if (element.getAttribute(WALKED_ATTRIBUTE) !== walkId)
    return

  // Translation-only containers have no original inline children left to
  // label. Restore an existing result explicitly instead of depending on a
  // paragraph attribute left over from its previous walk.
  if (toggle) {
    const previousWrappers = deepQueryTopLevelSelector(element, isTranslatedWrapperNode)
      .filter(wrapper => wrapper.getAttribute(WALKED_ATTRIBUTE) !== walkId)
    if (previousWrappers.length) {
      previousWrappers.forEach(removeTranslatedWrapperWithRestore)
      return
    }
  }

  const promises: Promise<void>[] = []

  if (element.hasAttribute(PARAGRAPH_ATTRIBUTE)) {
    let hasBlockNodeChild = false
    let hasBlockLayoutChild = false

    for (const child of element.childNodes) {
      if (isHTMLElement(child)) {
        if (child.hasAttribute(BLOCK_ATTRIBUTE))
          hasBlockNodeChild = true
        if (isNaturalBlockTransNode(child) || (child.hasAttribute(BLOCK_ATTRIBUTE) && isSiteRuleForceBlockStyleElement(child, config)))
          hasBlockLayoutChild = true
      }
    }

    const computedStyle = window.getComputedStyle(element)
    const isFlexParent = computedStyle.display.includes("flex")

    if (!hasBlockNodeChild) {
      promises.push(translateNodes([element], walkId, toggle, config, false, signal, translateRequest))
    }
    else {
      // prevent children change during iteration
      const children = [...element.childNodes]
      let consecutiveInlineNodes: ChildNode[] = []
      for (const child of children) {
        if (isTransNode(child) && isBlockTransNode(child) && !isTextNode(child)) {
          // force the children to be block translation style unless the parent is a flex parent
          promises.push(translateNodes(consecutiveInlineNodes, walkId, toggle, config, !isFlexParent && hasBlockLayoutChild, signal, translateRequest))
          consecutiveInlineNodes = []
          promises.push(translateWalkedElement(child, walkId, config, toggle, signal, translateRequest))
        }
        else {
          consecutiveInlineNodes.push(child)
        }
      }

      if (consecutiveInlineNodes.length) {
        promises.push(translateNodes(consecutiveInlineNodes, walkId, toggle, config, !isFlexParent && hasBlockLayoutChild, signal, translateRequest))
        consecutiveInlineNodes = []
      }
    }
  }
  else {
    for (const child of element.childNodes) {
      if (isHTMLElement(child)) {
        promises.push(translateWalkedElement(child, walkId, config, toggle, signal, translateRequest))
      }
    }
    if (element.shadowRoot) {
      for (const child of element.shadowRoot.children) {
        if (isHTMLElement(child)) {
          promises.push(translateWalkedElement(child, walkId, config, toggle, signal, translateRequest))
        }
      }
    }
  }
  // This simultaneously ensures that when concurrent translation
  // and external await call this function, all translations are completed
  await Promise.all(promises)
}
