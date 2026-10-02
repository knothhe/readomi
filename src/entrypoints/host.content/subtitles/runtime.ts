import type { Config } from "@/types/config/config"
import { i18n } from "#imports"
import { SUBTITLE_PRESETS } from "@/types/config/subtitle-style"
import { subscribeLocalConfig } from "@/utils/config/storage"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { eventMatchesHotkey, isEditableTarget } from "@/utils/hotkeys"
import { logger } from "@/utils/logger"
import { clampSubtitlePosition, saveSubtitleStyle, SUBTITLE_POSITIONS, subtitlePresetPatch, subtitleTextStyle } from "@/utils/subtitles/appearance"
import { bindSubtitleDrag } from "@/utils/subtitles/drag"
import { cueAt, readTrackCues } from "@/utils/subtitles/timeline"
import { SubtitleTranslationWindow } from "@/utils/subtitles/translation-window"
import { createYouTubeTimeline } from "@/utils/subtitles/youtube-client"

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
  updateConfig: (config: Config) => void
}

function mountPlayer(video: HTMLVideoElement, initialConfig: Config): Player {
  let config = initialConfig
  let appearance = config.features.subtitleStyle
  let renderedPosition = appearance.position
  const host = document.createElement("div")
  host.dataset.readomiSubtitles = ""
  host.className = "notranslate"
  host.setAttribute("translate", "no")
  const shadow = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = `:host{position:fixed!important;z-index:2147483646!important;pointer-events:none!important;display:block!important;width:max-content!important;transform:translate(-50%,-100%)!important}.box{position:relative;max-width:100%;box-sizing:border-box;font-family:system-ui;pointer-events:auto;touch-action:none;user-select:none;cursor:grab;outline:none}.box:focus-visible{outline:2px solid #fff8;outline-offset:6px}.box.dragging{cursor:grabbing}.original{font-size:.85em;margin-bottom:4px}.translated{font-size:1em}.empty{display:none}.tools{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;background:#151923;white-space:nowrap;font:12px system-ui;color:white;text-shadow:none;cursor:default;opacity:0;pointer-events:none;transition:opacity .15s}.box:hover .tools,.box:focus-within .tools,.box.dragging .tools{opacity:1;pointer-events:auto}.tools::after{content:"";position:absolute;top:100%;left:0;width:100%;height:8px}.tools-below .tools::after{top:auto;bottom:100%}.tools button,.tools select{font:12px system-ui;color:white;background:#ffffff1f;border:0;border-radius:4px;padding:4px 8px;cursor:pointer}.tools option{background:#151923;color:white}.tools button:disabled{opacity:.4;cursor:default}.tools button:focus-visible,.tools select:focus-visible{outline:2px solid white;outline-offset:2px}.tools-below .tools{bottom:auto;top:calc(100% + 8px)}`
  const box = document.createElement("div")
  const original = document.createElement("div")
  original.className = "original"
  const translated = document.createElement("div")
  translated.className = "translated"
  box.className = "box empty"
  box.tabIndex = 0
  box.setAttribute("role", "group")
  box.setAttribute("aria-label", i18n.t("subtitleStyle.dragHint"))
  box.title = i18n.t("subtitleStyle.dragHint")
  box.append(original, translated)
  shadow.append(style, box)
  document.documentElement.append(host)
  const nativeStyle = document.createElement("style")
  const youtubePlayer = video.closest(".html5-video-player")
  // Hide only this player's original captions. Restoration removes this style.
  const playerId = getRandomUUID()
  if (youtubePlayer) {
    youtubePlayer.setAttribute("data-readomi-caption-player", playerId)
    nativeStyle.textContent = `[data-readomi-caption-player="${playerId}"] .ytp-caption-window-container{visibility:hidden!important}`
    youtubePlayer.append(nativeStyle)
  }
  const modes = new Map<TextTrack, TextTrackMode>()
  const timeline = youtubePlayer ? createYouTubeTimeline() : null
  const provider = config.providersConfig.find(p => p.id === config.translate.providerId)
  const translations = new SubtitleTranslationWindow(async (input) => {
    if (!provider?.apiKey?.trim())
      throw new Error("Translation service is not configured")
    return translateTextCore({ text: input, langConfig: config.language, providerConfig: provider, extraHashTags: ["video-subtitles"] })
  })
  let timelineKey = ""
  let nativeCues = [] as ReturnType<typeof readTrackCues>
  let cueCount = -1
  let track: TextTrack | undefined
  let source = ""
  let text = ""
  let changedAt = 0
  const tools = document.createElement("div")
  tools.className = "tools"
  tools.title = ""
  const presetSelect = document.createElement("select")
  presetSelect.setAttribute("aria-label", i18n.t("subtitleStyle.preset"))
  for (const preset of SUBTITLE_PRESETS) {
    const option = document.createElement("option")
    option.value = preset
    option.textContent = i18n.t(`subtitleStyle.presets.${preset}`)
    presetSelect.append(option)
  }
  const sizeLabel = document.createElement("output")
  const button = (label: string, text: string) => {
    const element = document.createElement("button")
    element.type = "button"
    element.setAttribute("aria-label", label)
    element.title = label
    element.textContent = text
    return element
  }
  const smaller = button(i18n.t("subtitleStyle.smaller"), "−")
  const larger = button(i18n.t("subtitleStyle.larger"), "+")
  const resetPosition = button(i18n.t("subtitleStyle.resetPosition"), i18n.t("subtitleStyle.resetPositionShort"))
  const positionCaption = () => {
    const rect = video.getBoundingClientRect()
    host.style.maxWidth = `${rect.width * 0.8}px`
    renderedPosition = clampSubtitlePosition(appearance.position, rect, box.getBoundingClientRect())
    const centre = rect.width * renderedPosition.x / 100
    host.style.left = `${rect.left + centre}px`
    const toolHalf = tools.getBoundingClientRect().width / 2
    tools.style.left = `calc(50% + ${Math.max(toolHalf + 12, Math.min(centre, rect.width - toolHalf - 12)) - centre}px)`
    host.style.top = `${rect.top + rect.height * renderedPosition.y / 100}px`
    const captionTop = rect.height * renderedPosition.y / 100 - box.getBoundingClientRect().height
    box.classList.toggle("tools-below", captionTop < 48)
  }
  const renderAppearance = () => {
    Object.assign(box.style, subtitleTextStyle(appearance))
    presetSelect.value = appearance.preset
    sizeLabel.textContent = `${appearance.fontSize} px`
    smaller.disabled = appearance.fontSize <= 14
    larger.disabled = appearance.fontSize >= 40
    positionCaption()
  }
  const persist = (patch: Partial<typeof appearance>) => {
    appearance = { ...appearance, ...patch }
    renderAppearance()
    void saveSubtitleStyle(patch).catch(error => logger.error("Could not save subtitle appearance", error))
  }
  smaller.addEventListener("click", () => persist({ fontSize: Math.max(14, appearance.fontSize - 1) }))
  larger.addEventListener("click", () => persist({ fontSize: Math.min(40, appearance.fontSize + 1) }))
  resetPosition.addEventListener("click", () => persist({ position: SUBTITLE_POSITIONS.bottom }))
  presetSelect.addEventListener("change", () => persist(subtitlePresetPatch(presetSelect.value as typeof appearance.preset)))
  tools.append(presetSelect, smaller, sizeLabel, larger, resetPosition)
  box.prepend(tools)
  renderAppearance()
  const disposeDrag = bindSubtitleDrag(box, {
    videoRect: () => video.getBoundingClientRect(),
    position: () => renderedPosition,
    move: (position) => {
      appearance = { ...appearance, position }
      positionCaption()
    },
    commit: position => persist({ position }),
  })

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
    const currentSource = `${location.href}|${video.currentSrc || video.src}`
    if (currentSource !== source) {
      source = currentSource
      text = ""
      translations.reset()
      timelineKey = ""
      nativeCues = []
      cueCount = -1
      restoreTracks()
      track = undefined
    }
    const tracks = Array.from(video.textTracks).filter(t => t.kind === "subtitles" || t.kind === "captions")
    const selected = tracks.find(t => t.mode === "showing") ?? (track && tracks.includes(track) ? track : tracks.find(t => t.mode === "hidden") ?? tracks[0])
    if (selected !== track) {
      restoreTracks()
      track = selected
      translations.reset()
      nativeCues = []
      cueCount = -1
      text = ""
    }
    if (track && track.mode !== "hidden") {
      modes.set(track, track.mode)
      track.mode = "hidden"
    }
    const youtube = timeline?.tick()
    if (youtube && youtube.key !== timelineKey) {
      timelineKey = youtube.key
      translations.reset()
    }
    if (track && (track.cues?.length ?? 0) !== cueCount) {
      nativeCues = readTrackCues(track)
      cueCount = track.cues?.length ?? 0
    }
    const adPlaying = youtubePlayer?.classList.contains("ad-showing") || youtubePlayer?.classList.contains("ad-interrupting")
    const youtubeText = youtubePlayer && !adPlaying
      ? Array.from(youtubePlayer.querySelectorAll(".ytp-caption-segment")).map(el => el.textContent?.trim()).filter(Boolean).join("\n")
      : ""
    const cues = youtube?.cues.length ? youtube.cues : nativeCues
    const next = adPlaying || youtube?.enabled === false
      ? ""
      : cues.length
        ? cueAt(cues, video.currentTime)?.text ?? ""
        : youtubeText || (track ? readActiveCueText(track) : "")
    if (next !== text) {
      text = next
      changedAt = Date.now()
    }
    const visible = !!text && rect.width > 0 && rect.height > 0 && !video.ended
    box.classList.toggle("empty", !visible)
    original.textContent = config.features.subtitleMode === "bilingual" ? text : ""
    original.hidden = config.features.subtitleMode !== "bilingual"
    translated.textContent = translations.get(text) ?? (translations.hasFailed(text) ? i18n.t("subtitleTranslation.failed") : i18n.t(cues.length ? "subtitleTranslation.prefetching" : "subtitleTranslation.pending"))
    positionCaption()
    if (adPlaying || video.ended || youtube?.enabled === false) {
      translations.update([], video.currentTime, video.playbackRate, "")
      return
    }
    // Known timeline cues are stable; only DOM captions need the settling delay.
    translations.update(cues, video.currentTime, video.playbackRate, visible && (cues.length || Date.now() - changedAt >= 300) ? text : "")
  }
  return {
    tick,
    updateConfig: (next) => {
      config = next
      appearance = next.features.subtitleStyle
      renderAppearance()
      tick()
    },
    dispose: () => {
      disposeDrag()
      timeline?.dispose()
      translations.dispose()
      restoreTracks()
      host.remove()
      nativeStyle.remove()
      if (youtubePlayer?.getAttribute("data-readomi-caption-player") === playerId)
        youtubePlayer.removeAttribute("data-readomi-caption-player")
    },
  }
}

export function bootstrapVideoSubtitles() {
  const players = new Map<HTMLVideoElement, Player>()
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  let current: Config | null = null
  let suspended = false
  const reset = () => {
    clearInterval(timer)
    timer = undefined
    players.forEach(player => player.dispose())
    players.clear()
  }
  const reconcile = () => {
    reset()
    const config = current
    if (disposed || suspended || !config?.features.videoSubtitles)
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
  }
  const requestKey = (config: Config | null) => config && JSON.stringify([
    config.language,
    config.providersConfig.find(provider => provider.id === config.translate.providerId),
    config.translate.customPromptsConfig,
  ])
  const unsubscribe = subscribeLocalConfig((config) => {
    const previous = current
    current = config
    if (!config?.features.videoSubtitles)
      suspended = false
    if (config?.features.videoSubtitles && !suspended && timer !== undefined && requestKey(previous) === requestKey(config)) {
      // Mode, size and position changes must not discard the lookahead buffer.
      players.forEach(player => player.updateConfig(config))
    }
    else {
      reconcile()
    }
  })
  const keydown = (event: KeyboardEvent) => {
    if (!current?.features.videoSubtitles || event.defaultPrevented || event.repeat || isEditableTarget(event.target) || !eventMatchesHotkey(event, current.features.subtitlesShortcut))
      return
    event.preventDefault()
    event.stopPropagation()
    suspended = !suspended
    reconcile()
  }
  document.addEventListener("keydown", keydown, true)
  return () => {
    disposed = true
    document.removeEventListener("keydown", keydown, true)
    unsubscribe()
    reset()
  }
}
