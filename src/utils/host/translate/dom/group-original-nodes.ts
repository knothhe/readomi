interface SourceDisplay {
  source: HTMLElement
  owner: HTMLElement
  value: string
  priority: string
  owned: string
}

interface GroupOriginalNodes {
  sources: readonly HTMLElement[]
  displays: SourceDisplay[]
  onRestore: () => void
}

const originals = new WeakMap<HTMLElement, GroupOriginalNodes>()
const displayOwners = new WeakMap<HTMLElement, SourceDisplay>()

export function hasGroupOriginalNodes(wrapper: HTMLElement): boolean {
  return originals.has(wrapper)
}

/** The live sources stay in place, including their links and event handlers. */
export function rememberGroupOriginalNodes(wrapper: HTMLElement, sources: readonly HTMLElement[], onRestore: () => void): void {
  originals.set(wrapper, { sources: [...sources], displays: [], onRestore })
}

export function hideGroupOriginalNodes(wrapper: HTMLElement): void {
  const state = originals.get(wrapper)
  if (!state || state.displays.length)
    return
  for (const source of state.sources) {
    const previous = displayOwners.get(source)
    const inherited = previous && source.style.getPropertyValue("display") === previous.owned
      && source.style.getPropertyPriority("display") === "important"
      ? previous
      : undefined
    const display = {
      source,
      owner: wrapper,
      value: inherited?.value ?? source.style.getPropertyValue("display"),
      priority: inherited?.priority ?? source.style.getPropertyPriority("display"),
      owned: "none",
    }
    source.style.setProperty("display", display.owned, "important")
    display.owned = source.style.getPropertyValue("display")
    displayOwners.set(source, display)
    state.displays.push(display)
  }
}

/** Restore only properties still owned by this result; never recreate host DOM. */
export function restoreGroupOriginalNodes(wrapper: HTMLElement): boolean {
  const state = originals.get(wrapper)
  if (!state)
    return false
  originals.delete(wrapper)
  state.onRestore()
  for (const display of state.displays) {
    // The final result can inherit the preview's original display value.
    // Releasing that preview must then leave the final result's hiding intact.
    if (displayOwners.get(display.source) !== display)
      continue
    displayOwners.delete(display.source)
    if (display.source.style.getPropertyValue("display") !== display.owned
      || display.source.style.getPropertyPriority("display") !== "important") {
      continue
    }
    if (display.value)
      display.source.style.setProperty("display", display.value, display.priority)
    else
      display.source.style.removeProperty("display")
  }
  wrapper.remove()
  return true
}
