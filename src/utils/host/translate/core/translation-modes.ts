import type { PageTranslationRequest } from "../stream-request"
import type { Config } from "@/types/config/config"
import type { TranslationMode } from "@/types/config/translate"
import type { TransNode } from "@/types/dom"
import {
  CONTENT_WRAPPER_CLASS,
  NOTRANSLATE_CLASS,
  TRANSLATION_ERROR_CONTAINER_CLASS,
  TRANSLATION_MODE_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "../../../constants/dom-labels"
import { batchDOMOperation, flushBatchedOperations } from "../../dom/batch-dom"
import { isBlockTransNode, isCustomForceBlockTranslation, isHTMLElement, isNaturalBlockTransNode, isTextNode, isTransNode } from "../../dom/filter"
import { unwrapDeepestOnlyHTMLChild } from "../../dom/find"
import { getOwnerDocument } from "../../dom/node"
import { getTranslationGroup } from "../../dom/translation-group"
import { extractTextContent } from "../../dom/traversal"
import { extractInlineAtomText, renderInlineAtomTranslation } from "../dom/inline-atoms"
import { canReplaceOriginalNodes, markOriginalNodesReplaced, rememberOriginalNodes } from "../dom/original-nodes"
import { removeShadowHostInTranslatedWrapper, removeTranslatedWrapperWithRestore } from "../dom/translation-cleanup"
import { insertTranslatedNodeIntoWrapper } from "../dom/translation-insertion"
import { findPreviousTranslatedWrapperInside } from "../dom/translation-wrapper"
import { shouldFilterSmallParagraph } from "../filter-small-paragraph"
import { prepareTranslationText } from "../text-preparation"
import { setTranslationDirAndLang } from "../translation-attributes"
import { createSpinnerInside, getTranslatedTextAndRemoveSpinner } from "../ui/spinner"
import { resolveTranslationLayout, setPendingTranslationLayout } from "../ui/translation-layout"
import { isNumericContent } from "../ui/translation-utils"
import { translateTranslationGroup } from "./translation-group"
import { isTranslatingInWalk, MARK_ATTRIBUTES_REGEX, markTranslatingInWalk, originalContentMap, unmarkTranslatingInWalk } from "./translation-state"

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

function getDisplayTranslation(sourceText: string, translatedText: string | undefined) {
  if (translatedText === undefined) {
    return undefined
  }

  return prepareTranslationText(sourceText) === prepareTranslationText(translatedText)
    ? ""
    : translatedText
}

/**
 * Translates the nodes in the mode of the config. After `signal` aborts, the
 * translation no longer changes the page.
 */
export async function translateNodes(
  nodes: ChildNode[],
  walkId: string,
  toggle: boolean = false,
  config: Config,
  forceBlockTranslation: boolean = false,
  signal?: AbortSignal,
  translateRequest?: PageTranslationRequest,
): Promise<void> {
  const translationMode = config.translate.mode
  if (translationMode === "translationOnly") {
    await translateNodeTranslationOnlyMode(nodes, walkId, config, toggle, signal, translateRequest)
  }
  else if (translationMode === "bilingual") {
    await translateNodesBilingualMode(nodes, walkId, config, toggle, forceBlockTranslation, signal, translateRequest)
  }
}

export async function translateNodesBilingualMode(
  nodes: ChildNode[],
  walkId: string,
  config: Config,
  toggle: boolean = false,
  forceBlockTranslation: boolean = false,
  signal?: AbortSignal,
  translateRequest?: PageTranslationRequest,
): Promise<void> {
  const group = nodes.length === 1 && isHTMLElement(nodes[0]) ? getTranslationGroup(nodes[0], config) : undefined
  if (group) {
    await translateTranslationGroup(group, walkId, config, toggle, signal, translateRequest)
    return
  }
  const transNodes = nodes.filter(node => isTransNode(node))
  if (transNodes.length === 0 || signal?.aborted) {
    return
  }
  try {
    // prevent duplicate translation
    if (isTranslatingInWalk(transNodes, walkId)) {
      return
    }
    markTranslatingInWalk(transNodes, walkId)

    const lastNode = transNodes.at(-1)!
    let targetNode = lastNode
    if (transNodes.length === 1 && isBlockTransNode(lastNode) && isHTMLElement(lastNode) && (isNaturalBlockTransNode(lastNode) || isCustomForceBlockTranslation(lastNode, config))) {
      // Unwrapping also releases truncation along the single-child chain.
      // Preserve that behavior even when a site's explicit paragraph boundary
      // keeps the finished translation outside its innermost inline span.
      const unwrappedNode = unwrapDeepestOnlyHTMLChild(lastNode, config)
      targetNode = isCustomForceBlockTranslation(lastNode, config) ? lastNode : unwrappedNode
    }

    const existedTranslatedWrapper = findPreviousTranslatedWrapperInside(targetNode, walkId)
    if (existedTranslatedWrapper) {
      removeTranslatedWrapperWithRestore(existedTranslatedWrapper)
      if (toggle) {
        return
      }
      else {
        // The next attempt must see the old wrapper removed, rather than
        // recursively finding the same pending DOM operation.
        flushBatchedOperations()
        unmarkTranslatingInWalk(nodes, walkId)
        await translateNodesBilingualMode(nodes, walkId, config, toggle, false, signal, translateRequest)
        return
      }
    }

    const atomExtraction = extractInlineAtomText(transNodes, config)
    const textContent = atomExtraction.filterText.trim()
    const requestText = atomExtraction.requestText.trim()
    if (!textContent || isNumericContent(textContent))
      return

    if (shouldFilterSmallParagraph(textContent, config) || (atomExtraction.atoms.length > 0 && !atomExtraction.hasProse))
      return

    const ownerDoc = getOwnerDocument(targetNode)
    const translatedWrapperNode = ownerDoc.createElement("span")
    translatedWrapperNode.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
    translatedWrapperNode.setAttribute(TRANSLATION_MODE_ATTRIBUTE, "bilingual" satisfies TranslationMode)
    translatedWrapperNode.setAttribute(WALKED_ATTRIBUTE, walkId)
    setTranslationDirAndLang(translatedWrapperNode, config)
    const spinner = createSpinnerInside(translatedWrapperNode)
    if (translateRequest && !translateRequest.showSpinner)
      spinner.style.setProperty("display", "none", "important")

    // Batch DOM insertion to reduce layout thrashing
    const insertOperation = () => {
      if (signal?.aborted)
        return
      if (isTextNode(targetNode) || transNodes.length > 1) {
        targetNode.parentNode?.insertBefore(
          translatedWrapperNode,
          targetNode.nextSibling,
        )
      }
      else {
        targetNode.appendChild(translatedWrapperNode)
      }
    }
    batchDOMOperation(insertOperation)

    const typographyElement = isTextNode(targetNode) || transNodes.length > 1 ? targetNode.parentElement ?? undefined : targetNode
    const layout = resolveTranslationLayout(targetNode, forceBlockTranslation, config, transNodes)
    setPendingTranslationLayout(typographyElement, layout)
    const realTranslatedText = await getTranslatedTextAndRemoveSpinner(nodes, requestText, spinner, translatedWrapperNode, signal, translateRequest, typographyElement)
    if (signal?.aborted) {
      batchDOMOperation(() => translatedWrapperNode.remove())
      return
    }

    const translatedText = getDisplayTranslation(requestText, realTranslatedText)

    if (!translatedText) {
      // Only remove wrapper if translation returned empty (not needed),
      // but keep it for error display (undefined)
      if (translatedText === "") {
        // Batch the remove operation to execute remove operation after insert operation
        batchDOMOperation(() => translatedWrapperNode.remove())
      }
      return
    }

    await insertTranslatedNodeIntoWrapper(
      translatedWrapperNode,
      targetNode,
      translatedText,
      config.translate.translationNodeStyle,
      forceBlockTranslation,
      config,
      transNodes,
      atomExtraction.atoms.length ? (node, text) => renderInlineAtomTranslation(node, text, atomExtraction) : undefined,
      layout,
    )
  }
  finally {
    unmarkTranslatingInWalk(transNodes, walkId)
  }
}

export async function translateNodeTranslationOnlyMode(
  nodes: ChildNode[],
  walkId: string,
  config: Config,
  toggle: boolean = false,
  signal?: AbortSignal,
  translateRequest?: PageTranslationRequest,
): Promise<void> {
  const group = nodes.length === 1 && isHTMLElement(nodes[0]) ? getTranslationGroup(nodes[0], config) : undefined
  if (group) {
    await translateTranslationGroup(group, walkId, config, toggle, signal, translateRequest)
    return
  }
  const isTransNodeAndNotTranslatedWrapper = (node: Node): node is TransNode => {
    if (isHTMLElement(node) && node.classList.contains(CONTENT_WRAPPER_CLASS))
      return false
    return isTransNode(node)
  }

  const outerTransNodes = nodes.filter(isTransNode)
  if (outerTransNodes.length === 0 || signal?.aborted) {
    return
  }

  // snapshot the outer parent element, to prevent lose it if we go to deeper by unwrapDeepestOnlyHTMLChild
  // test case is:
  // <div data-testid="test-node">
  //   <span style={{ display: 'inline' }}>原文</span> // get the outer parent snapshot before go to inner element
  //   <br />
  //   <span style={{ display: 'inline' }}>原文</span>
  //   原文
  //   <br />
  //   <span style={{ display: 'inline' }}>原文</span>
  // </div>,
  // Only save originalContent when there's no existing translation wrapper
  // If wrapper exists, we're removing translation and should restore from saved content
  const ownedSnapshots: HTMLElement[] = []
  const outerParentElement = outerTransNodes[0].parentElement
  const hasExistingWrapper = outerParentElement?.querySelector(`.${CONTENT_WRAPPER_CLASS}`)
  if (outerParentElement && !originalContentMap.has(outerParentElement) && !hasExistingWrapper) {
    originalContentMap.set(outerParentElement, outerParentElement.innerHTML)
    ownedSnapshots.push(outerParentElement)
  }

  let transNodes: TransNode[] = []
  let allChildNodes: ChildNode[] = []
  if (outerTransNodes.length === 1 && isHTMLElement(outerTransNodes[0])) {
    const unwrappedHTMLChild = unwrapDeepestOnlyHTMLChild(outerTransNodes[0], config)
    allChildNodes = [...unwrappedHTMLChild.childNodes]
    transNodes = allChildNodes.filter(isTransNodeAndNotTranslatedWrapper)
  }
  else {
    transNodes = outerTransNodes
    allChildNodes = nodes
  }

  if (transNodes.length === 0) {
    return
  }

  try {
    if (isTranslatingInWalk(nodes, walkId)) {
      return
    }
    markTranslatingInWalk(nodes, walkId)

    const targetNode = transNodes.at(-1)!

    const parentNode = targetNode.parentElement
    if (!parentNode) {
      console.error("targetNode.parentElement is not HTMLElement", targetNode.parentElement)
      return
    }
    const existedTranslatedWrapper = findPreviousTranslatedWrapperInside(targetNode.parentElement, walkId)
    const existedTranslatedWrapperOutside = targetNode.parentElement.closest(`.${CONTENT_WRAPPER_CLASS}`)

    const finalTranslatedWrapper = existedTranslatedWrapperOutside ?? existedTranslatedWrapper
    if (finalTranslatedWrapper && isHTMLElement(finalTranslatedWrapper)) {
      if (finalTranslatedWrapper.querySelector(`.${TRANSLATION_ERROR_CONTAINER_CLASS}`)) {
        // A failed attempt has not replaced its source nodes. Keep those live
        // nodes for Retry instead of recreating them from an HTML snapshot.
        removeShadowHostInTranslatedWrapper(finalTranslatedWrapper)
        batchDOMOperation(() => finalTranslatedWrapper.remove())
      }
      else {
        removeTranslatedWrapperWithRestore(finalTranslatedWrapper)
      }
      if (toggle) {
        return
      }
      else {
        flushBatchedOperations()
        unmarkTranslatingInWalk(nodes, walkId)
        await translateNodeTranslationOnlyMode(nodes, walkId, config, toggle, signal, translateRequest)
        return
      }
    }

    const innerTextContent = transNodes.map(node => extractTextContent(node, config)).join("")
    if (!innerTextContent.trim() || isNumericContent(innerTextContent))
      return

    if (shouldFilterSmallParagraph(innerTextContent, config))
      return

    const cleanTextContent = (content: string): string => {
      if (!content)
        return content

      let cleanedContent = content.replace(MARK_ATTRIBUTES_REGEX, "")
      cleanedContent = cleanedContent.replace(HTML_COMMENT_RE, " ")

      return cleanedContent
    }

    // Only save originalContent when there's no existing translation wrapper
    const hasExistingWrapperInParent = parentNode.querySelector(`.${CONTENT_WRAPPER_CLASS}`)
    if (!originalContentMap.has(parentNode) && !hasExistingWrapperInParent) {
      originalContentMap.set(parentNode, parentNode.innerHTML)
      ownedSnapshots.push(parentNode)
    }

    const getStringFormatFromNode = (node: Element | Text) => {
      if (isTextNode(node)) {
        return node.textContent
      }
      return node.outerHTML
    }

    const textContent = cleanTextContent(transNodes.map(getStringFormatFromNode).join(""))
    if (!textContent)
      return

    const ownerDoc = getOwnerDocument(targetNode)
    const translatedWrapperNode = ownerDoc.createElement("span")
    translatedWrapperNode.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
    translatedWrapperNode.setAttribute(TRANSLATION_MODE_ATTRIBUTE, "translationOnly" satisfies TranslationMode)
    translatedWrapperNode.setAttribute(WALKED_ATTRIBUTE, walkId)
    translatedWrapperNode.style.display = "contents"
    rememberOriginalNodes(translatedWrapperNode, parentNode, allChildNodes)
    setTranslationDirAndLang(translatedWrapperNode, config)
    const spinner = createSpinnerInside(translatedWrapperNode)
    if (translateRequest && !translateRequest.showSpinner)
      spinner.style.setProperty("display", "none", "important")

    // Batch DOM insertion to reduce layout thrashing
    const insertOperation = () => {
      if (signal?.aborted)
        return
      if (isTextNode(targetNode) || transNodes.length > 1) {
        targetNode.parentNode?.insertBefore(
          translatedWrapperNode,
          targetNode.nextSibling,
        )
      }
      else {
        targetNode.appendChild(translatedWrapperNode)
      }
    }
    batchDOMOperation(insertOperation)

    const typographyElement = allChildNodes.at(-1)?.parentElement ?? parentNode
    const realTranslatedText = await getTranslatedTextAndRemoveSpinner(nodes, textContent, spinner, translatedWrapperNode, signal, translateRequest, typographyElement)
    if (signal?.aborted) {
      batchDOMOperation(() => translatedWrapperNode.remove())
      return
    }
    const translatedText = realTranslatedText ? getDisplayTranslation(textContent, realTranslatedText) : realTranslatedText

    if (!translatedText) {
      // Keep the wrapper when translation failed so the injected error UI remains visible.
      // Only remove the wrapper when translation returned an empty string.
      if (translatedText === "") {
        batchDOMOperation(() => {
          translatedWrapperNode.remove()
          // Preserving a unit never replaced its DOM. Once all units under a
          // parent are preserved, a later translation must snapshot fresh text.
          for (const parent of [parentNode, outerParentElement]) {
            if (parent && !parent.querySelector(`.${CONTENT_WRAPPER_CLASS}`))
              originalContentMap.delete(parent)
          }
        })
      }
      return
    }

    translatedWrapperNode.innerHTML = translatedText

    // Batch final DOM mutations to reduce layout thrashing
    batchDOMOperation(() => {
      if (signal?.aborted)
        return
      if (!canReplaceOriginalNodes(translatedWrapperNode)) {
        translatedWrapperNode.remove()
        return
      }
      // Insert translated content after the last node
      const lastChildNode = allChildNodes.at(-1)!
      lastChildNode.parentNode?.insertBefore(translatedWrapperNode, lastChildNode.nextSibling)

      // Remove all original nodes
      markOriginalNodesReplaced(translatedWrapperNode)
      allChildNodes.forEach(childNode => childNode.remove())
    })
  }
  finally {
    if (signal?.aborted)
      ownedSnapshots.forEach(node => originalContentMap.delete(node))
    unmarkTranslatingInWalk(nodes, walkId)
  }
}
