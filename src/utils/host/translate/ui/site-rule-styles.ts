import type { Config } from "@/types/config/config"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { getEffectiveSiteRule } from "@/utils/site-rules/effective"

type StyleRoot = Document | ShadowRoot
interface StyleState {
  style: HTMLStyleElement | null
  observer: MutationObserver
  css: string | null
}

// Strong references are intentional: content-script teardown must remove CSS
// from every translated shadow root as well as from the document.
const roots = new Map<StyleRoot, StyleState>()
const shadowDetachObservers = new Map<Document, { observer: MutationObserver, references: number }>()
let pageOwners = 0
let pendingOperations = 0

function retainShadowDetachObserver(doc: Document): void {
  const existing = shadowDetachObservers.get(doc)
  if (existing) {
    existing.references++
    return
  }
  const observer = new MutationObserver((records) => {
    if (records.some(record => record.removedNodes.length > 0))
      cleanupUnusedStyles()
  })
  observer.observe(doc, { childList: true, subtree: true })
  shadowDetachObservers.set(doc, { observer, references: 1 })
}

function releaseShadowDetachObserver(doc: Document): void {
  const state = shadowDetachObservers.get(doc)
  if (!state)
    return
  state.references--
  if (state.references === 0) {
    state.observer.disconnect()
    shadowDetachObservers.delete(doc)
  }
}

function applyCSS(root: StyleRoot, state: StyleState, css: string | null): void {
  if (state.css === css && (!css || state.style?.isConnected))
    return
  state.css = css
  if (!css) {
    state.style?.remove()
    state.style = null
    return
  }
  if (!state.style) {
    const doc = root instanceof Document ? root : root.ownerDocument
    state.style = doc.createElement("style")
    state.style.id = "readomi-site-rule-styles"
  }
  state.style.textContent = css
  if (!state.style.isConnected) {
    const parent = root instanceof Document ? root.head ?? root.documentElement : root
    parent.append(state.style)
  }
}

function cleanupUnusedStyles(): void {
  for (const [root, state] of roots) {
    const detached = root instanceof ShadowRoot && !root.host.isConnected
    if (!detached && (pageOwners > 0 || pendingOperations > 0 || root.querySelector(`.${CONTENT_WRAPPER_CLASS}`)))
      continue
    state.observer.disconnect()
    state.style?.remove()
    roots.delete(root)
    if (root instanceof ShadowRoot)
      releaseShadowDetachObserver(root.ownerDocument)
  }
}

/** Inject only after a page or paragraph translation has requested this root. */
export function ensureSiteRuleStyles(root: StyleRoot, config: Config): void {
  let state = roots.get(root)
  const css = getEffectiveSiteRule(config, window.location.href).injectedCss
  if (!state && !css)
    return
  if (!state) {
    const observer = new MutationObserver((records) => {
      if (records.some(record => record.removedNodes.length > 0))
        cleanupUnusedStyles()
    })
    state = { style: null, observer, css: null }
    roots.set(root, state)
    observer.observe(root, { childList: true, subtree: true })
    if (root instanceof ShadowRoot)
      retainShadowDetachObserver(root.ownerDocument)
  }
  applyCSS(root, state, css)
}

export function retainPageSiteRuleStyles(config: Config): () => void {
  pageOwners++
  ensureSiteRuleStyles(document, config)
  let released = false
  return () => {
    if (released)
      return
    released = true
    pageOwners--
    cleanupUnusedStyles()
  }
}

export function beginSiteRuleStyleOperation(root: StyleRoot, config: Config): () => void {
  pendingOperations++
  ensureSiteRuleStyles(root, config)
  let released = false
  return () => {
    if (released)
      return
    released = true
    pendingOperations--
    cleanupUnusedStyles()
  }
}

/** Reconcile only roots that already hold a translation session. */
export function refreshSiteRuleStyles(config: Config, url = window.location.href): void {
  const css = getEffectiveSiteRule(config, url).injectedCss
  for (const [root, state] of roots)
    applyCSS(root, state, css)
}

/** Remove owned styles without touching host nodes with a coinciding ID. */
export function clearSiteRuleStyles(): void {
  for (const state of roots.values()) {
    state.observer.disconnect()
    state.style?.remove()
  }
  roots.clear()
  for (const state of shadowDetachObservers.values())
    state.observer.disconnect()
  shadowDetachObservers.clear()
}
