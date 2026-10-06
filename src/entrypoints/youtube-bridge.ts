import { defineUnlistedScript } from "#imports"
import { installYouTubeSubtitleBridge } from "@/utils/subtitles/youtube-bridge"

export default defineUnlistedScript(() => {
  const script = document.currentScript as HTMLScriptElement | null
  if (script?.dataset.readomiDisabled === "true")
    return
  const cleanup = installYouTubeSubtitleBridge()
  script?.addEventListener("readomi:disable", cleanup, { once: true })
})
