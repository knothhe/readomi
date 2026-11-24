import type { ContentScriptContext } from "#imports"
import { hitPointer, samplePointer } from "@/utils/frame-pointer"
import { onMessage, sendMessage } from "@/utils/message"
import { subscribeHostConfig } from "@/utils/site-rules/preview-config"
import { runWhileSiteEnabled } from "@/utils/site-runtime"
import { setUILanguage } from "@/utils/ui-language"
import { mountHostToast } from "../host.content/mount-host-toast"
import { bindTranslationShortcutKey } from "../host.content/translation-control/bind-translation-shortcut"
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
      if (window !== window.top) {
        track(await bindTranslationShortcutKey(null, document, inactive))
        window.__READOMI_HIT_POINTER__ = hitPointer
        track(() => delete window.__READOMI_HIT_POINTER__)
        let enabled = false
        const move = (event: MouseEvent) => {
          if (enabled)
            samplePointer(event)
        }
        const leave = (event: MouseEvent) => {
          if (!event.relatedTarget)
            move(event)
        }
        document.addEventListener("mouseout", leave, true)
        track(() => document.removeEventListener("mouseout", leave, true))
        document.addEventListener("mouseover", move, true)
        track(() => document.removeEventListener("mouseover", move, true))
        document.addEventListener("mousemove", move, true)
        track(() => document.removeEventListener("mousemove", move, true))
        let pending = false
        const activate = () => {
          if (!enabled || pending || window.__READOMI_HOST_INJECTED__ || inactive())
            return
          pending = true
          void sendMessage("activateHoverFrame").catch(() => {}).finally(() => {
            pending = false
          })
        }
        track(onMessage("receiveHoverGesture", async ({ data }) => {
          if (!enabled || (data.point && !hitPointer(data.point)))
            return
          if (data.point && !window.__READOMI_HOVER_GESTURE__) {
            activate()
            for (let i = 0; i < 25 && !window.__READOMI_HOVER_GESTURE__ && !inactive(); i++)
              await new Promise(resolve => setTimeout(resolve, 20))
          }
          if (!inactive())
            window.__READOMI_HOVER_GESTURE__?.(data.hotkey, data.point)
        }))
        track(subscribeHostConfig((config) => {
          enabled = !!config?.features.hoverTranslation
          if (document.hasFocus() || document.querySelector(":hover"))
            activate()
        }))
        document.addEventListener("mouseover", activate, true)
        window.addEventListener("focus", activate)
        track(() => document.removeEventListener("mouseover", activate, true))
        track(() => window.removeEventListener("focus", activate))
      }
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
