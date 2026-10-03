import type { Config } from "@/types/config/config"
import type { TransNode } from "@/types/dom"
import {
  BLOCK_ATTRIBUTE,
  INLINE_ATTRIBUTE,
  MARK_ATTRIBUTES,
  PARAGRAPH_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "@/utils/constants/dom-labels"
import { ensureSiteRuleStyles } from "../translate/ui/site-rule-styles"
import {
  getEffectiveTagSet,
  isDontWalkIntoAndDontTranslateAsChildElement,
  isDontWalkIntoButTranslateAsChildElement,
  isHTMLElement,
  isShallowBlockHTMLElement,
  isShallowInlineHTMLElement,
  isSiteRuleForceBlockNodeElement,
  isSiteRuleForceInlineNodeElement,
  isTextNode,
  isTranslatedWrapperNode,
  isWithinIncludeScope,
  setNaturalTransNodeKind,
} from "./filter"

const NON_NEWLINE_WHITESPACE_RE = /[^\S\n]/

export interface ExtractTextContentOptions {
  replaceElement?: (element: HTMLElement) => string | undefined
}

export function extractTextContent(node: TransNode, config: Config, options: ExtractTextContentOptions = {}): string {
  if (isTextNode(node)) {
    const text = node.textContent ?? ""
    const trimmed = text.trim()
    if (trimmed === "")
      return " "
    const leadingWs = text.slice(0, text.length - text.trimStart().length)
    const trailingWs = text.slice(text.trimEnd().length)
    const hasLeading = NON_NEWLINE_WHITESPACE_RE.test(leadingWs)
    const hasTrailing = NON_NEWLINE_WHITESPACE_RE.test(trailingWs)
    return (hasLeading ? " " : "") + trimmed + (hasTrailing ? " " : "")
  }

  // Handle <br> elements as line breaks
  if (isHTMLElement(node) && node.tagName === "BR") {
    return "\n"
  }

  // We already don't walk and label the element which isDontWalkIntoElement
  // for the parent element we already walk and label, if we have a notranslate element inside this parent element,
  // we should extract the text content of the parent.
  // Historical regression
  // if (isDontWalkIntoButTranslateAsChildElement(node)) {
  //   return ''
  // }

  if (isTranslatedWrapperNode(node))
    return ""

  const replacement = options.replaceElement?.(node)
  if (replacement !== undefined)
    return replacement

  if (isDontWalkIntoAndDontTranslateAsChildElement(node, config)) {
    return ""
  }

  const childNodes = [...node.childNodes]
  return childNodes.reduce((text: string, child: Node): string => {
    // TODO: support SVGElement in the future
    if (isTextNode(child) || isHTMLElement(child)) {
      return text + extractTextContent(child, config, options)
    }
    return text
  }, "")
}

export function walkAndLabelElement(
  element: HTMLElement,
  walkId: string,
  config: Config,
): { forceBlock: boolean, isInlineNode: boolean } {
  if (isTranslatedWrapperNode(element))
    return { forceBlock: false, isInlineNode: false }
  // A route or rule change can change the same element's classification.
  // Never let attributes from an earlier walk survive that decision.
  for (const attribute of MARK_ATTRIBUTES)
    element.removeAttribute(attribute)

  if (isDontWalkIntoButTranslateAsChildElement(element, config) || isDontWalkIntoAndDontTranslateAsChildElement(element, config)) {
    clearWalkLabels(element)
    return {
      forceBlock: false,
      isInlineNode: false,
    }
  }

  const root = element.getRootNode()
  ensureSiteRuleStyles(root instanceof ShadowRoot ? root : element.ownerDocument, config)

  element.setAttribute(WALKED_ATTRIBUTE, walkId)

  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) {
      if (isHTMLElement(child)) {
        walkAndLabelElement(child, walkId, config)
      }
    }
  }

  let hasInlineNodeChild = false
  let forceBlock = false

  for (const child of [...element.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) {
        hasInlineNodeChild = true
      }
      continue
    }

    if (isHTMLElement(child)) {
      const result = walkAndLabelElement(child, walkId, config)

      forceBlock = forceBlock || result.forceBlock

      if (result.isInlineNode) {
        hasInlineNodeChild = true
      }
    }
  }

  if (hasInlineNodeChild && element !== element.ownerDocument.documentElement && isWithinIncludeScope(element, config)) {
    element.setAttribute(PARAGRAPH_ATTRIBUTE, "")
  }

  // force block will force the current and ancestor elements to be block node
  forceBlock = forceBlock || getEffectiveTagSet(config, "forceBlockTags").has(element.tagName)

  if (element.textContent?.trim() === "" && !forceBlock) {
    setNaturalTransNodeKind(element, "none")
    return {
      forceBlock: false,
      isInlineNode: false,
    }
  }

  const computedStyle = element.ownerDocument.defaultView!.getComputedStyle(element)
  const naturalBlockNode = forceBlock || isShallowBlockHTMLElement(element, computedStyle, config)
  const naturalInlineNode = !naturalBlockNode && isShallowInlineHTMLElement(element, computedStyle, config)
  setNaturalTransNodeKind(element, naturalBlockNode ? "block" : naturalInlineNode ? "inline" : "none")

  const siteBlockNode = isSiteRuleForceBlockNodeElement(element, config)
  const siteInlineNode = !forceBlock && !siteBlockNode && isSiteRuleForceInlineNodeElement(element, config)
  const isBlockNode = forceBlock || siteBlockNode || (!siteInlineNode && naturalBlockNode)
  const isInlineNode = !isBlockNode && (siteInlineNode || naturalInlineNode)

  if (isBlockNode) {
    element.setAttribute(BLOCK_ATTRIBUTE, "")
  }
  else if (isInlineNode) {
    element.setAttribute(INLINE_ATTRIBUTE, "")
  }

  return {
    forceBlock,
    isInlineNode,
  }
}

function clearWalkLabels(element: HTMLElement): void {
  if (isTranslatedWrapperNode(element))
    return
  for (const attribute of MARK_ATTRIBUTES)
    element.removeAttribute(attribute)
  setNaturalTransNodeKind(element, "none")
  for (const child of element.children) {
    if (isHTMLElement(child))
      clearWalkLabels(child)
  }
  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) {
      if (isHTMLElement(child))
        clearWalkLabels(child)
    }
  }
}
