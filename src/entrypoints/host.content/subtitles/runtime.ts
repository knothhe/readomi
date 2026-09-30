import type { Config } from "@/types/config/config"
import { i18n } from "#imports"
import { subscribeLocalConfig } from "@/utils/config/storage"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { translateTextCore } from "@/utils/host/translate/translate-text"

/** Text-track support follows Read Frog's local subtitle adapter. No hosted services. */
export function readActiveCueText(track: TextTrack): string {
  return Array.from(track.activeCues ?? []).map((cue) => {
    if (!("text" in cue) || typeof cue.text !== "string")
      return ""
    const template = document.createElement("template")
    template.innerHTML = cue.text.replace(/<[^>]*>/g, "")
    return template.content.textContent?.trim() ?? ""
  }).filter(Boolean).join("\n")
}

interface Player {
  tick: () => void
  dispose: () => void
}

function mountPlayer(video: HTMLVideoElement, config: Config): Player {
  const host = document.createElement("div")
  host.dataset.readingSubtitles = ""
  host.className = "notranslate"
  host.setAttribute("translate", "no")
  const shadow = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = ":host{position:fixed!important;z-index:2147483646!important;pointer-events:none!important;display:block!important}.box{background:rgba(15,20,35,.85);color:#fff;border-radius:8px;padding:10px 16px;text-align:center;white-space:pre-line;font:500 18px/1.5 system-ui;max-width:100%;box-sizing:border-box}.original{font-size:15px;margin-bottom:4px}.empty{display:none}"
  const box = document.createElement("div")
  const original = document.createElement("div")
  original.className = "original"
  const translated = document.createElement("div")
  box.className = "box empty"
  box.append(original, translated)
  shadow.append(style, box)
  document.documentElement.append(host)
  const nativeStyle = document.createElement("style")
  const youtubePlayer = video.closest(".html5-video-player")
  // Hide only this player's original captions. Restoration removes this style.
  const playerId = getRandomUUID()
  if (youtubePlayer) {
    youtubePlayer.setAttribute("data-reading-caption-player", playerId)
    nativeStyle.textContent = `[data-reading-caption-player="${playerId}"] .ytp-caption-window-container{visibility:hidden!important}`
    youtubePlayer.append(nativeStyle)
  }
  const modes = new Map<TextTrack, TextTrackMode>()
  const cache = new Map<string, string>()
  let track: TextTrack | undefined
  let source = ""
  let text = ""
  let changedAt = 0
  let request: string | null = null
  let failed: string | null = null
  let disposed = false
  let generation = 0

  const restoreTracks = () => {
    for (const [track, mode] of modes) {
      if (track.mode === "hidden")
        track.mode = mode
    }
    modes.clear()
  }
  const tick = () => {
    const fullscreen = document.fullscreenElement
    if (fullscreen && fullscreen !== video && fullscreen.contains(video)) {
      if (host.parentElement !== fullscreen)
        fullscreen.append(host)
    }
    else if (host.parentElement !== document.documentElement) {
      document.documentElement.append(host)
    }
    const rect = video.getBoundingClientRect()
    host.style.left = `${rect.left + rect.width * 0.1}px`
    host.style.top = `${rect.top + rect.height * 0.75}px`
    host.style.width = `${rect.width * 0.8}px`
    const currentSource = `${location.href}|${video.currentSrc || video.src}`
    if (currentSource !== source) {
      source = currentSource
      generation++
      text = ""
      failed = null
      cache.clear()
      restoreTracks()
      track = undefined
    }
    const tracks = Array.from(video.textTracks).filter(t => t.kind === "subtitles" || t.kind === "captions")
    const selected = tracks.find(t => t.mode === "showing") ?? (track && tracks.includes(track) ? track : tracks.find(t => t.mode === "hidden") ?? tracks[0])
    if (selected !== track) {
      restoreTracks()
      track = selected
      generation++
      cache.clear()
      text = ""
      failed = null
    }
    if (track && track.mode !== "hidden") {
      modes.set(track, track.mode)
      track.mode = "hidden"
    }
    const youtubeText = youtubePlayer && !youtubePlayer.classList.contains("ad-showing") && !youtubePlayer.classList.contains("ad-interrupting")
      ? Array.from(youtubePlayer.querySelectorAll(".ytp-caption-segment")).map(el => el.textContent?.trim()).filter(Boolean).join("\n")
      : ""
    const next = youtubeText || (track ? readActiveCueText(track) : "")
    if (next !== text) {
      text = next
      changedAt = Date.now()
      failed = null
    }
    const visible = !!text && rect.width > 0 && rect.height > 0 && !video.ended
    box.classList.toggle("empty", !visible)
    original.textContent = config.features.subtitleMode === "bilingual" ? text : ""
    original.hidden = config.features.subtitleMode !== "bilingual"
    translated.textContent = cache.get(text) ?? (failed === text ? i18n.t("subtitleTranslation.failed") : i18n.t("subtitleTranslation.pending"))
    if (!visible || request || cache.has(text) || failed === text || Date.now() - changedAt < 300)
      return
    const provider = config.providersConfig.find(p => p.id === config.translate.providerId)
    if (!provider?.apiKey?.trim()) {
      failed = text
      return
    }
    const input = text
    const token = generation
    request = input
    void translateTextCore({ text: input, langConfig: config.language, providerConfig: provider, extraHashTags: ["video-subtitles"] }).then((result) => {
      if (disposed || token !== generation)
        return
      if (cache.size >= 200)
        cache.delete(cache.keys().next().value!)
      cache.set(input, result)
    }).catch(() => {
      if (!disposed && token === generation && text === input)
        failed = input
    }).finally(() => {
      request = null
    })
  }
  return {
    tick,
    dispose: () => {
      disposed = true
      generation++
      restoreTracks()
      host.remove()
      nativeStyle.remove()
      if (youtubePlayer?.getAttribute("data-reading-caption-player") === playerId)
        youtubePlayer.removeAttribute("data-reading-caption-player")
    },
  }
}

export function bootstrapVideoSubtitles() {
  const players = new Map<HTMLVideoElement, Player>()
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  const reset = () => {
    clearInterval(timer)
    timer = undefined
    players.forEach(player => player.dispose())
    players.clear()
  }
  const unsubscribe = subscribeLocalConfig((config) => {
    reset()
    if (disposed || !config?.features.videoSubtitles)
      return
    const tick = () => {
      for (const [video, player] of players) {
        if (!video.isConnected) {
          player.dispose()
          players.delete(video)
        }
      }
      for (const video of document.querySelectorAll("video")) {
        if (!players.has(video))
          players.set(video, mountPlayer(video, config))
      }
      players.forEach(player => player.tick())
    }
    tick()
    timer = setInterval(tick, 250)
  })
  return () => {
    disposed = true
    unsubscribe()
    reset()
  }
}
