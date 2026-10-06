export type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement

export function getDeepActiveElement(doc: Document = document): Element | null {
  let element = doc.activeElement
  while (element?.shadowRoot?.activeElement)
    element = element.shadowRoot.activeElement
  return element
}

export function getEditable(element: Element | null): Editable | null {
  if (!(element instanceof HTMLElement))
    return null
  if (element instanceof HTMLInputElement)
    return ["text", "search", "url", "tel", "email"].includes(element.type) && !element.disabled && !element.readOnly ? element : null
  if (element instanceof HTMLTextAreaElement)
    return !element.disabled && !element.readOnly ? element : null
  if (!element.isContentEditable)
    return null
  // A focused child belongs to the outer editing host, unless editing is disabled.
  let host: HTMLElement = element
  while (host.parentElement?.isContentEditable)
    host = host.parentElement
  return host.getAttribute("aria-readonly") === "true" || host.getAttribute("aria-disabled") === "true" ? null : host
}

export function readEditableText(element: Editable): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    return element.value
  // Preserve visible paragraph and <br> boundaries in rich editors.
  // eslint-disable-next-line unicorn/prefer-dom-node-text-content
  return element.innerText ?? element.textContent ?? ""
}

export const INPUT_REPLACE_REQUEST = "readomi:replace-input"
export const INPUT_REPLACE_RESPONSE = "readomi:replace-input-result"
export const INPUT_REQUEST_ATTRIBUTE = "data-readomi-input-request"
