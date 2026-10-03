// Keep selector batches bounded for DOM implementations with a length limit.
// Commas inside :is/:has, attribute values, or quoted strings are not separators.
const selectorChunks = new Map<string, readonly string[]>()
const MAX_SELECTOR_BATCH_LENGTH = 1800

function chunksFor(selector: string): readonly string[] {
  if (selector.length <= MAX_SELECTOR_BATCH_LENGTH)
    return [selector]
  const cached = selectorChunks.get(selector)
  if (cached)
    return cached
  const selectors: string[] = []
  let depth = 0
  let quote = ""
  let escaped = false
  let start = 0
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote)
        quote = ""
      continue
    }
    if (char === "\"" || char === "'") {
      quote = char
    }
    else if (char === "(" || char === "[") {
      depth++
    }
    else if (char === ")" || char === "]") {
      depth--
    }
    else if (char === "," && depth === 0) {
      selectors.push(selector.slice(start, index))
      start = index + 1
    }
  }
  selectors.push(selector.slice(start))
  const chunks: string[] = []
  let current = ""
  for (const item of selectors) {
    if (current && current.length + item.length + 1 > MAX_SELECTOR_BATCH_LENGTH) {
      chunks.push(current)
      current = ""
    }
    current = current ? `${current},${item}` : item
  }
  if (current)
    chunks.push(current)
  if (selectorChunks.size >= 128)
    selectorChunks.delete(selectorChunks.keys().next().value!)
  selectorChunks.set(selector, chunks)
  return chunks
}

export function matchesSiteRuleSelector(element: Element, selector: string | null): boolean {
  return selector !== null && chunksFor(selector).some(chunk => element.matches(chunk))
}

export function isInsideSiteRuleSelector(element: Element, selector: string | null): boolean {
  return selector !== null && chunksFor(selector).some(chunk => element.closest(chunk) !== null)
}

export function querySiteRuleSelector<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  return [...new Set(chunksFor(selector).flatMap(chunk => [...root.querySelectorAll<T>(chunk)]))]
}
