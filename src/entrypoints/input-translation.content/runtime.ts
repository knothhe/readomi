import type { ContentScriptContext } from "#imports"
import { subscribeHostConfig } from "@/utils/site-rules/preview-config"
import { setUILanguage } from "@/utils/ui-language"
import { mountHostToast } from "../host.content/mount-host-toast"
import { bindInputTranslation } from "../host.content/translation-control/input-translation"

declare global {
  interface Window { __READOMI_INPUT_TRANSLATION__?: boolean }
}

/** Input translation is available even in frames without the page runtime. */
export async function bootstrapInputTranslation(ctx: ContentScriptContext) {
  if (ctx.isInvalid || window.__READOMI_INPUT_TRANSLATION__)
    return
  window.__READOMI_INPUT_TRANSLATION__ = true
  const cleanups: Array<() => void> = []
  let stopped = false
  const cleanup = () => {
    if (stopped)
      return
    stopped = true
    for (const dispose of cleanups.splice(0).reverse())
      dispose()
    window.__READOMI_INPUT_TRANSLATION__ = false
  }
  ctx.onInvalidated(cleanup)
  const track = (dispose: () => void) => stopped ? dispose() : cleanups.push(dispose)
  // Poll WXT's context validity so updates also remove listeners and pending UI.
  const timer = ctx.setInterval(() => {}, 1000)
  track(() => clearInterval(timer))
  try {
    track(subscribeHostConfig(config => setUILanguage(config?.ui.language ?? "browser")))
    // This script has its own toast store, including in frames without host.js.
    track(mountHostToast())
    track(await bindInputTranslation(document, () => ctx.isInvalid))
  }
  catch (error) {
    cleanup()
    if (!ctx.isInvalid)
      throw error
  }
}
