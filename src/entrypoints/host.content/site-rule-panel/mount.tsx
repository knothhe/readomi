import type { SiteRulePreviewController } from "@/utils/site-rules/preview-controller"
import { createRoot } from "react-dom/client"
import themeCSS from "@/assets/styles/theme.css?inline"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { NOTRANSLATE_CLASS, REACT_SHADOW_HOST_CLASS } from "@/utils/constants/dom-labels"
import { attachCornerHost } from "@/utils/corner-dock"
import { ShadowHostBuilder } from "@/utils/react-shadow-host/shadow-host-builder"
import { SiteRulePanel } from "./panel"
import panelCSS from "./style.css?inline"

export function mountSiteRulePanel(controller: SiteRulePreviewController): () => void {
  const host = document.createElement("div")
  host.classList.add(REACT_SHADOW_HOST_CLASS, NOTRANSLATE_CLASS)
  host.setAttribute("data-readomi-site-rule-panel", "")
  const shadow = host.attachShadow({ mode: "open" })
  const builder = new ShadowHostBuilder(shadow, { position: "block", inheritStyles: false, cssContent: [themeCSS, panelCSS], style: { display: "contents" } })
  const container = builder.build()
  const root = createRoot(container)
  root.render(<ThemeProvider container={container}><SiteRulePanel controller={controller} /></ThemeProvider>)
  const detach = attachCornerHost(host)
  let removed = false
  return () => {
    if (removed)
      return
    removed = true
    root.unmount()
    builder.cleanup()
    detach()
  }
}
