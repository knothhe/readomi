import type { Editable } from "./editable"
import { INPUT_REPLACE_REQUEST, INPUT_REPLACE_RESPONSE, INPUT_REQUEST_ATTRIBUTE } from "./editable"

/** Native editing keeps replacement in the browser's undo history. */
export function replaceNativeInput(element: HTMLInputElement | HTMLTextAreaElement, text: string): boolean {
  // Native insertion truncates at maxlength before reporting success. Reject
  // oversized translations before selecting or changing the user's draft.
  if (element.maxLength >= 0 && text.length > element.maxLength)
    return false
  element.select()
  const original = element.value
  try {
    if (element.ownerDocument.execCommand?.("insertText", false, text) && element.value === text)
      return true
  }
  catch {
    // Some input types and browsers do not expose native text editing.
  }
  if (element.value !== original)
    return false
  // Notify controlled React inputs through the native setter and a bubbling event.
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text)
  element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText", data: text }))
  return element.value === text
}

/** Rich editor state is owned by the page, so mutation runs in the main world. */
export function replaceEditableText(element: Editable, text: string, expected: string, signal: AbortSignal): Promise<boolean> {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    return Promise.resolve(replaceNativeInput(element, text))
  return new Promise((resolve) => {
    const id = crypto.randomUUID()
    const win = element.ownerDocument.defaultView!
    let timeout: ReturnType<typeof setTimeout>
    function finish(ok: boolean) {
      clearTimeout(timeout)
      win.removeEventListener("message", receive)
      signal.removeEventListener("abort", cancel)
      if (element.getAttribute(INPUT_REQUEST_ATTRIBUTE) === id)
        element.removeAttribute(INPUT_REQUEST_ATTRIBUTE)
      resolve(ok)
    }
    function receive(event: MessageEvent) {
      if (event.source === win && event.origin === win.origin && event.data?.type === INPUT_REPLACE_RESPONSE && event.data.id === id)
        finish(event.data.ok === true)
    }
    function cancel() {
      finish(false)
    }
    timeout = setTimeout(finish, 1500, false)
    win.addEventListener("message", receive)
    signal.addEventListener("abort", cancel, { once: true })
    element.setAttribute(INPUT_REQUEST_ATTRIBUTE, id)
    win.postMessage({ type: INPUT_REPLACE_REQUEST, id, text, expected }, win.origin === "null" ? "*" : win.origin)
  })
}
