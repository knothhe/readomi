import { REACT_SHADOW_HOST_CLASS, TRANSLATION_MODE_ATTRIBUTE } from "../../../constants/dom-labels"
import { removeReactShadowHost } from "../../../react-shadow-host/create-shadow-host"
import { batchDOMOperation } from "../../dom/batch-dom"
import { isHTMLElement, isTranslatedWrapperNode } from "../../dom/filter"
import { deepQueryTopLevelSelector } from "../../dom/find"
import { originalContentMap } from "../core/translation-state"
import { hasGroupOriginalNodes, restoreGroupOriginalNodes } from "./group-original-nodes"
import { hasOriginalNodes, restoreOriginalNodes } from "./original-nodes"

export function removeShadowHostInTranslatedWrapper(wrapper: HTMLElement): void {
  // Remove React shadow hosts (for error components)
  const translationShadowHost = wrapper.querySelector(`.${REACT_SHADOW_HOST_CLASS}`)
  if (translationShadowHost && isHTMLElement(translationShadowHost)) {
    removeReactShadowHost(translationShadowHost)
  }

  // Remove lightweight spinners
  const spinner = wrapper.querySelector(".readomi-spinner")
  if (spinner) {
    batchDOMOperation(() => spinner.remove())
  }
}

/**
 * Remove translated wrapper and restore original content based on translation mode
 * @param wrapper - The translated wrapper element to remove
 */
export function removeTranslatedWrapperWithRestore(wrapper: HTMLElement): void {
  removeShadowHostInTranslatedWrapper(wrapper)

  if (hasGroupOriginalNodes(wrapper)) {
    batchDOMOperation(() => restoreGroupOriginalNodes(wrapper))
    return
  }

  const translationMode = wrapper.getAttribute(TRANSLATION_MODE_ATTRIBUTE)

  if (translationMode === "translationOnly") {
    if (hasOriginalNodes(wrapper)) {
      const parent = wrapper.parentElement
      batchDOMOperation(() => {
        restoreOriginalNodes(wrapper)
        let current: HTMLElement | null = parent
        while (current) {
          originalContentMap.delete(current)
          current = current.parentElement
        }
      })
      // A live record is preferred over an HTML snapshot. Pending/error wrappers
      // have not replaced their source, so removing them preserves page updates.
      return
    }
    // For translation-only mode, find nearest ancestor in originalContentMap and restore
    let currentNode = wrapper.parentNode

    while (currentNode && isHTMLElement(currentNode)) {
      const originalContent = originalContentMap.get(currentNode)
      if (originalContent) {
        const nodeToRestore = currentNode
        batchDOMOperation(() => {
          nodeToRestore.innerHTML = originalContent
        })
        originalContentMap.delete(currentNode)
        return
      }
      currentNode = currentNode.parentNode
    }
  }

  // For bilingual mode or when no original content is found, just remove the wrapper
  batchDOMOperation(() => wrapper.remove())
}

export function removeAllTranslatedWrapperNodes(
  root: Document | ShadowRoot = document,
): void {
  const translatedNodes = deepQueryTopLevelSelector(root, isTranslatedWrapperNode)
  translatedNodes.forEach((contentWrapperNode) => {
    removeTranslatedWrapperWithRestore(contentWrapperNode)
  })
}
