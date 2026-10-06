import type { ContentScriptContext } from "#imports"
import { subscribeHostConfig } from "@/utils/site-rules/preview-config"
import { runWhileSiteEnabled } from "@/utils/site-runtime"
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
  ctx.onInvalidated(() => window.__READOMI_INPUT_TRANSLATION__ = false)
  try {
    await runWhileSiteEnabled(ctx, async (track, inactive) => {
      track(subscribeHostConfig(config => setUILanguage(config?.ui.language ?? "browser")))
      track(mountHostToast())
      track(await bindInputTranslation(document, inactive))
    })
  }
  catch (error) {
    window.__READOMI_INPUT_TRANSLATION__ = false
    if (!ctx.isInvalid)
      throw error
  }
}
