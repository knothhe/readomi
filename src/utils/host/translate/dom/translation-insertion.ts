import type { TranslationLayout } from "../ui/translation-layout"
import type { Config } from "@/types/config/config"
import type { TranslationNodeStyleConfig } from "@/types/config/translate"
import type { TransNode } from "@/types/dom"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { getHostPreviewContext } from "@/utils/site-rules/preview-config"
import { describePreviewElement, recordSiteRulePreview } from "@/utils/site-rules/preview-observations"
import {
  BLOCK_CONTENT_CLASS,
  FLOAT_WRAP_ATTRIBUTE,
  INLINE_CONTENT_CLASS,
  NOTRANSLATE_CLASS,
  PARAGRAPH_ATTRIBUTE,
} from "../../../constants/dom-labels"
import { isHTMLElement } from "../../dom/filter"
import { getOwnerDocument } from "../../dom/node"
import { decorateTranslationNode } from "../ui/decorate-translation"
import { resolveTranslationLayout } from "../ui/translation-layout"

function isFloatedElement(element: HTMLElement): boolean {
  const floatValue = window.getComputedStyle(element).float
  return floatValue === "left" || floatValue === "right"
}

function hasVisibleLayoutBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function findActiveFloatSibling(paragraphElement: HTMLElement): HTMLElement | null {
  const flowContainer = paragraphElement.parentElement
  if (!flowContainer)
    return null

  const paragraphRect = paragraphElement.getBoundingClientRect()

  for (const sibling of flowContainer.children) {
    if (!isHTMLElement(sibling))
      continue
    if (sibling === paragraphElement || sibling.contains(paragraphElement))
      continue

    const floatCandidates = [sibling, ...sibling.querySelectorAll<HTMLElement>("*")]
    for (const candidate of floatCandidates) {
      if (!isFloatedElement(candidate) || !hasVisibleLayoutBox(candidate))
        continue

      const floatRect = candidate.getBoundingClientRect()
      const verticallyAffectsParagraph = paragraphRect.top < floatRect.bottom - 1 && paragraphRect.bottom > floatRect.top + 1
      if (verticallyAffectsParagraph)
        return candidate
    }
  }

  return null
}

function shouldWrapInsideFloatFlow(targetNode: TransNode): boolean {
  const paragraphElement = isHTMLElement(targetNode)
    ? (targetNode.hasAttribute(PARAGRAPH_ATTRIBUTE) ? targetNode : targetNode.closest<HTMLElement>(`[${PARAGRAPH_ATTRIBUTE}]`))
    : targetNode.parentElement?.closest<HTMLElement>(`[${PARAGRAPH_ATTRIBUTE}]`)
  if (!paragraphElement)
    return false

  const activeFloat = findActiveFloatSibling(paragraphElement)
  return !!activeFloat
}

export function addInlineTranslation(ownerDoc: Document, translatedWrapperNode: HTMLElement, translatedNode: HTMLElement): void {
  const spaceNode = ownerDoc.createElement("span")
  spaceNode.textContent = "  "
  translatedWrapperNode.appendChild(spaceNode)
  translatedNode.className = `${NOTRANSLATE_CLASS} ${INLINE_CONTENT_CLASS}`
}

export function addBlockTranslation(ownerDoc: Document, translatedWrapperNode: HTMLElement, translatedNode: HTMLElement): void {
  const brNode = ownerDoc.createElement("br")
  translatedWrapperNode.appendChild(brNode)
  translatedNode.className = `${NOTRANSLATE_CLASS} ${BLOCK_CONTENT_CLASS}`
  // Match the streaming renderer and keep paragraph breaks in plain-text
  // responses, including when host styles reset every span's white-space.
  translatedNode.style.whiteSpace = "pre-wrap"
}

export async function insertTranslatedNodeIntoWrapper(
  translatedWrapperNode: HTMLElement,
  targetNode: TransNode,
  translatedText: string,
  translationNodeStyle: TranslationNodeStyleConfig,
  forceBlockTranslation: boolean = false,
  config: Config = DEFAULT_CONFIG,
  styleSources: readonly TransNode[] = [targetNode],
  renderTranslatedContent?: (node: HTMLElement, text: string) => void,
  resolvedLayout?: TranslationLayout | null,
): Promise<void> {
  // Use the wrapper's owner document
  const ownerDoc = getOwnerDocument(translatedWrapperNode)
  const previewContext = getHostPreviewContext()
  const translatedNode = ownerDoc.createElement("span")
  const layout = resolvedLayout === undefined
    ? resolveTranslationLayout(targetNode, forceBlockTranslation, config, styleSources)
    : resolvedLayout
  if (layout === "block") {
    addBlockTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  }
  else if (layout === "inline") {
    addInlineTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  }
  else {
    // not inline or block, maybe notranslate
    return
  }

  if (renderTranslatedContent)
    renderTranslatedContent(translatedNode, translatedText)
  else
    translatedNode.textContent = translatedText
  translatedWrapperNode.appendChild(translatedNode)
  await decorateTranslationNode(translatedNode, translationNodeStyle)
  recordSiteRulePreview({ event: "layout-final", target: describePreviewElement(isHTMLElement(targetNode) ? targetNode : targetNode.parentElement ?? translatedWrapperNode), layout, ...previewContext })

  if (translatedNode.classList.contains(BLOCK_CONTENT_CLASS) && shouldWrapInsideFloatFlow(targetNode)) {
    translatedNode.setAttribute(FLOAT_WRAP_ATTRIBUTE, "true")
  }
}
