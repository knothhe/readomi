import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"

export const LAYOUT_OWNER_ATTRIBUTE = "data-readomi-layout-owner"
const owner = `[${LAYOUT_OWNER_ATTRIBUTE}]`
const wrapper = `.${CONTENT_WRAPPER_CLASS}`

// Replace the old unconditional inline-style writes along the unwrap chain.
// No owner or no live wrapper means no effect on the host, including when the
// request was filtered, preserved, cancelled, or removed by the site itself.
export const TRANSLATION_LAYOUT_CSS = `
:where(${owner}, ${owner} *):has(${wrapper}) {
  max-height: none !important;
  -webkit-line-clamp: unset !important;
  text-overflow: clip !important;
}`

interface OwnerState {
  wrappers: Set<HTMLElement>
  original: string | null
}
const owners = new Map<HTMLElement, OwnerState>()
const wrappers = new Map<HTMLElement, HTMLElement[]>()

/** Call after insertion so text-only units can use the actual insertion parent. */
export function retainTranslationLayout(wrapper: HTMLElement, sources: readonly Node[]): void {
  if (wrappers.has(wrapper) || !wrapper.isConnected)
    return
  const elements = sources.filter((node): node is HTMLElement => node.nodeType === 1)
  const ownsInsertionParent = !elements.length || elements.some(element => element.contains(wrapper))
    || (sources.length > 1 && sources.every(node => node.parentNode === wrapper.parentNode))
  if (ownsInsertionParent && wrapper.parentElement)
    elements.push(wrapper.parentElement)
  // A clipped title often sits in a neutral single-child shell. Claim that
  // chain too, but stop as soon as another host element or text shares it.
  // Never turn a list/grid containing several cards into a layout owner.
  for (const source of [...elements]) {
    if (!source.contains(wrapper))
      continue
    let current = source
    while (current.parentElement && current.parentElement !== current.ownerDocument.body
      && current.parentElement !== current.ownerDocument.documentElement) {
      const parent = current.parentElement
      const children = [...parent.childNodes].filter(node => node.nodeType === 1
        ? !(node as Element).classList.contains(CONTENT_WRAPPER_CLASS)
        : !!node.textContent?.trim())
      if (children.length !== 1 || children[0] !== current)
        break
      elements.push(parent)
      current = parent
    }
  }
  const targets = [...new Set(elements)].filter(element => element !== element.ownerDocument.body && element !== element.ownerDocument.documentElement)
  wrappers.set(wrapper, targets)
  for (const element of targets) {
    let state = owners.get(element)
    if (!state) {
      state = { wrappers: new Set(), original: element.getAttribute(LAYOUT_OWNER_ATTRIBUTE) }
      owners.set(element, state)
      element.setAttribute(LAYOUT_OWNER_ATTRIBUTE, "true")
    }
    state.wrappers.add(wrapper)
  }
}

export function releaseTranslationLayout(wrapper: HTMLElement): void {
  const targets = wrappers.get(wrapper)
  if (!targets)
    return
  wrappers.delete(wrapper)
  for (const element of targets) {
    const state = owners.get(element)!
    state.wrappers.delete(wrapper)
    if (state.wrappers.size)
      continue
    owners.delete(element)
    // Preserve an attribute update made by the host while translation ran.
    if (element.getAttribute(LAYOUT_OWNER_ATTRIBUTE) !== "true")
      continue
    if (state.original === null)
      element.removeAttribute(LAYOUT_OWNER_ATTRIBUTE)
    else
      element.setAttribute(LAYOUT_OWNER_ATTRIBUTE, state.original)
  }
}

export function releaseDetachedTranslationLayouts(): void {
  for (const wrapper of wrappers.keys()) {
    if (!wrapper.isConnected)
      releaseTranslationLayout(wrapper)
  }
}

export function clearTranslationLayouts(): void {
  for (const wrapper of wrappers.keys())
    releaseTranslationLayout(wrapper)
}
