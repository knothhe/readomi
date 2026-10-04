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
import { getTranslationGroup } from "./translation-group"

const NON_NEWLINE_WHITESPACE_RE = /[^\S\n]/

export interface ExtractTextContentOptions {
  replaceElement?: (element: HTMLElement) => string | undefined
  /** Keep visual paragraph boundaries when site rules group block children into one request. */
  preserveBlockBoundaries?: boolean
}

function hasBlockTextLayout(element: HTMLElement): boolean {
  // Inline atom replacement can include native MathML, whose computed style
  // is unavailable in some DOM environments and is not an HTML block.
  if (element.namespaceURI && element.namespaceURI !== "http://www.w3.org/1999/xhtml")
    return false
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const display = style?.display.trim().toLowerCase() ?? ""
  // These are visual boundaries, independent of the walk's inline/block
  // markers. A forced-inline div still starts a paragraph on the page.
  return !!display && display !== "none" && display !== "contents"
    && !display.startsWith("inline") && !display.startsWith("ruby")
    && style?.float !== "left" && style?.float !== "right"
}

export function extractTextContentFromNodes(
  nodes: readonly Node[],
  config: Config,
  options: ExtractTextContentOptions = {},
): string {
  let text = ""
  let previousBlock = false
  for (const child of nodes) {
    // TODO: support SVGElement in the future
    if (!isTextNode(child) && !isHTMLElement(child))
      continue
    const childText = extractTextContent(child, config, options)
    const hasContent = childText.trim() !== ""
    const block = !!options.preserveBlockBoundaries && hasContent
      && isHTMLElement(child) && child.tagName !== "BR" && hasBlockTextLayout(child)
    if (hasContent && (block || previousBlock) && text.trim()) {
      const before = text.trimEnd()
      const after = childText.trimStart()
      const boundary = text.slice(before.length) + childText.slice(0, childText.length - after.length)
      // Nested single-child blocks do not add breaks of their own. Join only
      // neighboring content, retaining any authored extra blank lines.
      const lineBreaks = Math.max(2, boundary.split("\n").length - 1)
      text = `${before}${"\n".repeat(lineBreaks)}${after}`
    }
    else {
      text += childText
    }
    if (hasContent)
      previousBlock = block
  }
  return text
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

  return extractTextContentFromNodes([...node.childNodes], config, options)
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

  // A declared group bypasses descendant block propagation. Its selected
  // sources can contain headings, lists and paragraphs without splitting the
  // post or walking the custom element's metadata/action shadow tree.
  if (getTranslationGroup(element, config)) {
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
    element.setAttribute(PARAGRAPH_ATTRIBUTE, "")
    element.setAttribute(BLOCK_ATTRIBUTE, "")
    setNaturalTransNodeKind(element, "block")
    return { forceBlock: false, isInlineNode: false }
  }

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
