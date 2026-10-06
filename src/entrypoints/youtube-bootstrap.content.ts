import { defineContentScript, injectScript } from "#imports"
import { runWhileSiteEnabled } from "@/utils/site-runtime"

export default defineContentScript({
  matches: ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"],
  allFrames: true,
  runAt: "document_start",
  async main(ctx) {
    await runWhileSiteEnabled(ctx, async (track) => {
      await injectScript("/youtube-bridge.js", {
        modifyScript(script) {
          track(() => {
            script.dataset.readomiDisabled = "true"
            script.dispatchEvent(new CustomEvent("readomi:disable"))
          })
        },
      }).catch(() => {
        // DOM captions remain available if page script injection is blocked.
      })
    })
  },
})
