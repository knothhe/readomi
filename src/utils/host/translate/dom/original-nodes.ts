import { isTranslatedWrapperNode } from "../../dom/filter"

interface OriginalNodes {
  parent: HTMLElement
  nodes: ChildNode[]
  text: (string | null)[]
  replaced: boolean
  start?: Comment
  end?: Comment
}

const originals = new WeakMap<HTMLElement, OriginalNodes>()

export function hasOriginalNodes(wrapper: HTMLElement): boolean {
  return originals.has(wrapper)
}

export function rememberOriginalNodes(wrapper: HTMLElement, parent: HTMLElement, nodes: ChildNode[]): void {
  originals.set(wrapper, {
    parent,
    nodes: [...nodes],
    text: nodes.map(node => node.textContent),
    replaced: false,
  })
}

function hasNewSource(state: OriginalNodes, wrapper: HTMLElement): boolean {
  const first = state.replaced ? state.start?.nextSibling : state.nodes[0]
  const end = state.replaced ? state.end : state.nodes.at(-1)?.nextSibling
  let current: ChildNode | null | undefined = first
  let containsWrapper = !state.replaced
  while (current && current !== end) {
    if (current === wrapper)
      containsWrapper = true
    if (current !== wrapper && !state.nodes.includes(current) && !isTranslatedWrapperNode(current)
      && (current.nodeType === Node.ELEMENT_NODE || !!current.textContent?.trim())) {
      return true
    }
    current = current.nextSibling
  }
  return current !== end || !containsWrapper
}

export function canReplaceOriginalNodes(wrapper: HTMLElement): boolean {
  const state = originals.get(wrapper)
  return !!state && !hasNewSource(state, wrapper)
    && state.nodes.every((node, index) => node.parentNode === state.parent && node.textContent === state.text[index])
}

export function markOriginalNodesReplaced(wrapper: HTMLElement): void {
  const state = originals.get(wrapper)
  if (state) {
    state.start = state.parent.ownerDocument.createComment("readomi-source-start")
    state.end = state.parent.ownerDocument.createComment("readomi-source-end")
    state.parent.insertBefore(state.start, state.nodes[0])
    state.parent.insertBefore(state.end, wrapper.nextSibling)
    state.replaced = true
  }
}

/** Restore live source nodes; a host replacement wins over the old translation. */
export function restoreOriginalNodes(wrapper: HTMLElement): boolean {
  const state = originals.get(wrapper)
  if (!state)
    return false
  originals.delete(wrapper)
  if (state.replaced && wrapper.parentNode === state.parent
    && state.start?.parentNode === state.parent && state.end?.parentNode === state.parent
    && !hasNewSource(state, wrapper)) {
    for (const node of state.nodes) {
      if (!node.parentNode)
        state.parent.insertBefore(node, wrapper)
    }
  }
  wrapper.remove()
  state.start?.remove()
  state.end?.remove()
  return true
}
