import { defineContentScript, injectScript } from "#imports"

export default defineContentScript({
  matches: ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"],
  allFrames: true,
  runAt: "document_start",
  main() {
    void injectScript("/youtube-bridge.js").catch(() => {
      // DOM captions remain available if page script injection is blocked.
    })
  },
})
