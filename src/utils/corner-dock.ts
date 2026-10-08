import cornerCSS from "@/components/corner-feedback.css?inline"
import { NOTRANSLATE_CLASS, REACT_SHADOW_HOST_CLASS } from "@/utils/constants/dom-labels"

/**
 * Separate content-script bundles share a DOM dock, not a module singleton.
 * Each keeps its own shadow styles, React root and cleanup lifetime.
 */
export function attachCornerHost(host: HTMLElement): () => void {
  let shared = document.querySelector<HTMLElement>("[data-readomi-corner-host]")
  if (!shared?.shadowRoot) {
    shared = document.createElement("div")
    shared.classList.add(NOTRANSLATE_CLASS, REACT_SHADOW_HOST_CLASS)
    shared.setAttribute("data-readomi-corner-host", "")
    const shadow = shared.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = `:host{all:initial}slot{display:contents}::slotted(*){display:contents!important}${cornerCSS}`
    const dock = document.createElement("div")
    dock.className = "readomi-corner-dock"
    dock.appendChild(document.createElement("slot"))
    shadow.append(style, dock)
    document.documentElement.appendChild(shared)
  }
  // The adaptation panel stays at the bottom regardless of script load order.
  const panel = shared.querySelector("[data-readomi-site-rule-panel]")
  shared.insertBefore(host, host.hasAttribute("data-readomi-site-rule-panel") ? null : panel)
  return () => {
    host.remove()
    if (!shared.childElementCount)
      shared.remove()
  }
}
