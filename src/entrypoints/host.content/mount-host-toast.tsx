import ReactDOM from "react-dom/client"
import themeCSS from "@/assets/styles/theme.css?inline"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { Toasts } from "@/components/toast"
import { REACT_SHADOW_HOST_CLASS } from "@/utils/constants/dom-labels"
import { attachCornerHost } from "@/utils/corner-dock"
import { ShadowHostBuilder } from "@/utils/react-shadow-host/shadow-host-builder"

export function mountHostToast(): () => void {
  const shadowHost = document.createElement("div")
  shadowHost.classList.add(REACT_SHADOW_HOST_CLASS)
  shadowHost.setAttribute("data-readomi-host-toast", "")

  const shadowRoot = shadowHost.attachShadow({ mode: "open" })
  const hostBuilder = new ShadowHostBuilder(shadowRoot, {
    position: "block",
    cssContent: [themeCSS],
    inheritStyles: false,
    style: { display: "contents" },
  })
  const reactContainer = hostBuilder.build()

  const root = ReactDOM.createRoot(reactContainer)
  root.render(
    <ThemeProvider container={reactContainer}>
      <Toasts embedded />
    </ThemeProvider>,
  )

  const detach = attachCornerHost(shadowHost)

  let cleaned = false

  return () => {
    if (cleaned)
      return

    cleaned = true
    root.unmount()
    hostBuilder.cleanup()
    detach()
  }
}
