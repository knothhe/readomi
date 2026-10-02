import { defineUnlistedScript } from "#imports"
import { installYouTubeSubtitleBridge } from "@/utils/subtitles/youtube-bridge"

export default defineUnlistedScript(() => {
  installYouTubeSubtitleBridge()
})
