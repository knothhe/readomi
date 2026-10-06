import { defineContentScript } from "#imports"
import { getDeepActiveElement, getEditable, INPUT_REPLACE_REQUEST, INPUT_REPLACE_RESPONSE, INPUT_REQUEST_ATTRIBUTE, readEditableText } from "@/utils/input-translation/editable"
import { replaceText } from "./replace-text"

declare global {
  interface Window { __READOMI_INPUT_INJECTOR__?: boolean }
}

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  allFrames: true,
  world: "MAIN",
  runAt: "document_start",
  main() {
    if (window.__READOMI_INPUT_INJECTOR__)
      return
    window.__READOMI_INPUT_INJECTOR__ = true
    window.addEventListener("message", (event) => {
      const data = event.data
      if (event.source !== window || event.origin !== window.origin || data?.type !== INPUT_REPLACE_REQUEST)
        return
      if (typeof data.id !== "string" || typeof data.text !== "string" || typeof data.expected !== "string")
        return
      const element = getEditable(getDeepActiveElement())
      if (!element || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.getAttribute(INPUT_REQUEST_ATTRIBUTE) !== data.id)
        return
      let ok = false
      try {
        if (readEditableText(element) === data.expected)
          ok = replaceText(element, data.text)
      }
      catch {
        // Report failure without changing the editor through an unsafe fallback.
      }
      window.postMessage({ type: INPUT_REPLACE_RESPONSE, id: data.id, ok }, window.origin === "null" ? "*" : window.origin)
    })
  },
})
