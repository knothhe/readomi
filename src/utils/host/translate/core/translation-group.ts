import type { TranslationGroup } from "../../dom/translation-group"
import type { PageTranslationRequest } from "../stream-request"
import type { Config } from "@/types/config/config"
import {
  CONTENT_WRAPPER_CLASS,
  NOTRANSLATE_CLASS,
  TRANSLATION_ERROR_CONTAINER_CLASS,
  TRANSLATION_MODE_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "@/utils/constants/dom-labels"
import { batchDOMOperation, flushBatchedOperations } from "../../dom/batch-dom"
import { getTranslationGroup, registerTranslationGroupWrapper } from "../../dom/translation-group"
import { hideGroupOriginalNodes, rememberGroupOriginalNodes } from "../dom/group-original-nodes"
import { extractInlineAtomText, renderInlineAtomTranslation } from "../dom/inline-atoms"
import { removeTranslatedWrapperWithRestore } from "../dom/translation-cleanup"
import { insertTranslatedNodeIntoWrapper } from "../dom/translation-insertion"
import { shouldFilterSmallParagraph } from "../filter-small-paragraph"
import { prepareTranslationText } from "../text-preparation"
import { setTranslationDirAndLang } from "../translation-attributes"
import { createSpinnerInside, getTranslatedTextAndRemoveSpinner } from "../ui/spinner"
import { setPendingTranslationLayout } from "../ui/translation-layout"
import { isNumericContent } from "../ui/translation-utils"
import { isTranslatingInWalk, MARK_ATTRIBUTES_REGEX, markTranslatingInWalk, unmarkTranslatingInWalk } from "./translation-state"

interface GroupState {
  group: TranslationGroup
  parents: (ParentNode | null)[]
  signatures: string[]
  wrapper: HTMLElement
  controller: AbortController
  observer: MutationObserver
  mounted: boolean
  lockedNodes: ChildNode[]
  walkId: string
  disposed: boolean
  invalidated: boolean
  reportedInvalidation: boolean
}

const states = new WeakMap<HTMLElement, GroupState>()

function sourceSignature(source: HTMLElement): string {
  return source.innerHTML.replace(MARK_ATTRIBUTES_REGEX, "")
}

function sourcesChanged(state: GroupState, group: TranslationGroup): boolean {
  return !group.container.isConnected || group.sources.length !== state.group.sources.length
    || (state.mounted && (!state.wrapper.isConnected
      || state.wrapper.parentNode !== (group.placement === "append" ? group.container : group.container.parentNode)))
    || group.sources.some((source, index) => source !== state.group.sources[index]
      || !source.isConnected || source.parentNode !== state.parents[index]
      || sourceSignature(source) !== state.signatures[index])
}

function invalidateState(state: GroupState): void {
  if (state.disposed)
    return
  state.invalidated = true
  if (states.get(state.group.container) === state)
    unmarkTranslatingInWalk(state.lockedNodes, state.walkId)
  state.controller.abort()
  removeTranslatedWrapperWithRestore(state.wrapper)
}

/** Page mutations re-observe the owner only when its selected sources changed. */
export function invalidateTranslationGroupIfChanged(group: TranslationGroup): boolean {
  const state = states.get(group.container)
  if (!state)
    return false
  if (state.invalidated && !state.reportedInvalidation) {
    state.reportedInvalidation = true
    return true
  }
  if (state.disposed || !sourcesChanged(state, group))
    return false
  invalidateState(state)
  state.reportedInvalidation = true
  return true
}

/** One card result from explicitly selected live sources, independent of its metadata and slots. */
export async function translateTranslationGroup(
  initialGroup: TranslationGroup,
  walkId: string,
  config: Config,
  toggle = false,
  signal?: AbortSignal,
  translateRequest?: PageTranslationRequest,
): Promise<void> {
  if (signal?.aborted || !initialGroup.container.isConnected)
    return
  const container = initialGroup.container
  const previous = states.get(container)
  if (previous && !previous.disposed) {
    const changed = sourcesChanged(previous, initialGroup)
    const failed = !!previous.wrapper.querySelector(`.${TRANSLATION_ERROR_CONTAINER_CLASS}`)
    if (!toggle && !changed && !failed)
      return
    if (!changed && !failed && isTranslatingInWalk([container], walkId))
      return
    previous.controller.abort()
    removeTranslatedWrapperWithRestore(previous.wrapper)
    flushBatchedOperations()
    if (toggle && !changed && !failed)
      return
  }
  const group = getTranslationGroup(container, config) ?? initialGroup
  if (!group.sources.length)
    return
  const lockedNodes = [container, ...group.sources]
  if (isTranslatingInWalk(lockedNodes, walkId))
    return
  markTranslatingInWalk(lockedNodes, walkId)
  let state: GroupState | undefined
  let removeAbortListener: (() => void) | undefined
  try {
    const extraction = extractInlineAtomText(group.sources, config)
    const text = extraction.filterText.trim()
    const requestText = extraction.requestText.trim()
    if (!text || isNumericContent(text) || shouldFilterSmallParagraph(text, config)
      || (extraction.atoms.length > 0 && !extraction.hasProse)) {
      return
    }

    const doc = container.ownerDocument
    const wrapper = doc.createElement("span")
    wrapper.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
    wrapper.setAttribute(TRANSLATION_MODE_ATTRIBUTE, config.translate.mode)
    wrapper.setAttribute(WALKED_ATTRIBUTE, walkId)
    wrapper.style.setProperty("display", "block", "important")
    if (config.translate.mode === "translationOnly")
      wrapper.style.setProperty("margin", "8px 0", "important")
    if (group.placement === "append" && group.slot)
      wrapper.setAttribute("slot", group.slot)
    registerTranslationGroupWrapper(wrapper, container)
    setTranslationDirAndLang(wrapper, config)

    const controller = new AbortController()
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const observer = new doc.defaultView!.MutationObserver(() => {
      if (!state || state.disposed)
        return
      const latest = getTranslationGroup(container, config)
      if (!latest || sourcesChanged(state, latest))
        invalidateState(state)
    })
    state = {
      group,
      parents: group.sources.map(source => source.parentNode),
      signatures: group.sources.map(sourceSignature),
      wrapper,
      controller,
      observer,
      mounted: false,
      lockedNodes,
      walkId,
      disposed: false,
      invalidated: false,
      reportedInvalidation: false,
    }
    const ownedState = state
    states.set(container, ownedState)
    rememberGroupOriginalNodes(wrapper, group.sources, () => {
      ownedState.disposed = true
      ownedState.observer.disconnect()
      if (states.get(container) === ownedState)
        unmarkTranslatingInWalk(ownedState.lockedNodes, ownedState.walkId)
      ownedState.controller.abort()
    })
    observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true })
    if (container.parentNode)
      observer.observe(container.parentNode, { childList: true })
    const abort = () => {
      translateRequest?.cancel?.()
      removeTranslatedWrapperWithRestore(wrapper)
    }
    requestSignal.addEventListener("abort", abort, { once: true })
    removeAbortListener = () => requestSignal.removeEventListener("abort", abort)

    const current = () => !requestSignal.aborted && states.get(container) === ownedState
      && !ownedState.disposed && !sourcesChanged(ownedState, getTranslationGroup(container, config) ?? { ...group, sources: [] })
    batchDOMOperation(() => {
      if (!current())
        return
      if (group.placement === "after")
        container.parentNode?.insertBefore(wrapper, container.nextSibling)
      else
        container.append(wrapper)
      ownedState.mounted = wrapper.isConnected
    })
    const spinner = createSpinnerInside(wrapper)
    if (translateRequest && !translateRequest.showSpinner)
      spinner.style.setProperty("display", "none", "important")
    setPendingTranslationLayout(container, "block")
    const result = await getTranslatedTextAndRemoveSpinner([container], requestText, spinner, wrapper, requestSignal, translateRequest, container)
    if (!current()) {
      removeTranslatedWrapperWithRestore(wrapper)
      return
    }
    if (result === undefined)
      return
    if (!result || prepareTranslationText(result) === prepareTranslationText(requestText)) {
      removeTranslatedWrapperWithRestore(wrapper)
      return
    }
    if (config.translate.mode === "translationOnly") {
      const translated = doc.createElement("span")
      translated.className = NOTRANSLATE_CLASS
      translated.style.display = "block"
      translated.style.whiteSpace = "pre-wrap"
      if (extraction.atoms.length)
        renderInlineAtomTranslation(translated, result, extraction)
      else
        translated.textContent = result
      wrapper.append(translated)
    }
    else {
      await insertTranslatedNodeIntoWrapper(
        wrapper, container, result, config.translate.translationNodeStyle, true, config, [container],
        extraction.atoms.length ? (node, value) => renderInlineAtomTranslation(node, value, extraction) : undefined,
        "block",
      )
      // The group's wrapper already owns a block slot. A leading BR would
      // add a line that its streaming wrapper never reserved.
      if (wrapper.firstElementChild?.tagName === "BR")
        wrapper.firstElementChild.remove()
    }
    batchDOMOperation(() => {
      if (!current()) {
        removeTranslatedWrapperWithRestore(wrapper)
        return
      }
      if (config.translate.mode === "translationOnly")
        hideGroupOriginalNodes(wrapper)
    })
  }
  finally {
    removeAbortListener?.()
    if (!state || states.get(container) === state)
      unmarkTranslatingInWalk(lockedNodes, walkId)
  }
}
