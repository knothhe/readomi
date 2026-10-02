import type { SubtitleCue } from "./timeline"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { YOUTUBE_SUBTITLE_REQUEST, YOUTUBE_SUBTITLE_RESPONSE } from "./youtube-bridge"

export function youtubeVideoId(): string {
  const url = new URL(location.href)
  return url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1] ?? ""
}

export function createYouTubeTimeline() {
  let videoId = ""
  let key = ""
  let cues: SubtitleCue[] = []
  let enabled: boolean | null = null
  let requestId = ""
  let sentAt = -Infinity
  const onMessage = (event: MessageEvent) => {
    const data = event.data
    if (event.source !== window || event.origin !== location.origin || data?.type !== YOUTUBE_SUBTITLE_RESPONSE || data.requestId !== requestId || data.videoId !== videoId || typeof data.key !== "string")
      return
    requestId = ""
    if (data.enabled === true || data.enabled === false || data.enabled === null)
      enabled = data.enabled
    if (key !== data.key) {
      key = data.key
      cues = []
    }
    if (Array.isArray(data.cues) && data.cues.length <= 30_000) {
      cues = data.cues.filter((cue: SubtitleCue) => cue && typeof cue.text === "string" && cue.text.length <= 4000 && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start).sort((a: SubtitleCue, b: SubtitleCue) => a.start - b.start)
    }
  }
  window.addEventListener("message", onMessage)
  return {
    tick() {
      const next = youtubeVideoId()
      if (next !== videoId) {
        videoId = next
        cues = []
        key = ""
        enabled = null
        requestId = ""
        sentAt = -Infinity
      }
      if (videoId && Date.now() - sentAt >= (requestId ? 10_000 : 1000)) {
        requestId = getRandomUUID()
        sentAt = Date.now()
        window.postMessage({ type: YOUTUBE_SUBTITLE_REQUEST, requestId, videoId, knownKey: cues.length ? key : "" }, location.origin)
      }
      return { key, cues, enabled }
    },
    dispose() {
      window.removeEventListener("message", onMessage)
    },
  }
}
