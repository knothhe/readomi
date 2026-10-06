import type { LangCodeISO6393 } from "@/definitions"
import type { Config } from "@/types/config/config"
import type { SubtitleStyle } from "@/types/config/subtitle-style"
import type { SubtitleStatus } from "@/types/subtitle-status"
import type { VideoTranslationControls } from "@/utils/subtitles/translation-controls"
import { i18n } from "#imports"
import { NO_VIDEO_STATUS } from "@/types/subtitle-status"
import { subscribeLocalConfig } from "@/utils/config/storage"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { isExtensionContextInvalidatedError, isExtensionContextValid } from "@/utils/extension-context"
import { prepareTranslationText } from "@/utils/host/translate/text-preparation"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { setTranslationDirAndLang } from "@/utils/host/translate/translation-attributes"
import { eventMatchesHotkey, isEditableTarget } from "@/utils/hotkeys"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { resolveSubtitleFontSize, resolveSubtitlePosition, saveSubtitleStyle, subtitlePositionName, subtitleTextStyle, subtitleVideoSize } from "@/utils/subtitles/appearance"
import { shouldShowVideoControls } from "@/utils/subtitles/control-sites"
import { bindSubtitleDrag } from "@/utils/subtitles/drag"
import { createYouTubeCaptionPosition } from "@/utils/subtitles/player-controls"
import { createTextTrackSession } from "@/utils/subtitles/text-track-session"
import { cueAt, readTrackCues } from "@/utils/subtitles/timeline"
import { createVideoTranslationControls } from "@/utils/subtitles/translation-controls"
import { SubtitleTranslationWindow } from "@/utils/subtitles/translation-window"
import { isVideoTranslationExcluded } from "@/utils/subtitles/video-site-rules"
import { currentXVideo, isXHost, xCaptionBottom, xVideoIdentity } from "@/utils/subtitles/x-player"
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
  retry: () => void
  status: () => SubtitleStatus
  tick: () => void
  dispose: () => void
  updateConfig: (config: Config, enabled: boolean, excluded: boolean, storedChange?: boolean) => void
}

interface SubtitleRenderer {
  retry: () => void
  status: () => SubtitleStatus["state"]
  tick: () => void
  dispose: () => void
  updateConfig: (config: Config) => void
}

function mountSubtitleRenderer(video: HTMLVideoElement, initialConfig: Config, onStyleChange: (patch: Partial<SubtitleStyle>) => void): SubtitleRenderer {
  const view = video.ownerDocument.defaultView
  let disposed = false
  let positionFrame: number | undefined
  let config = initialConfig
  let appearance = config.features.subtitleStyle
  let renderedPosition = appearance.position
  let renderedRect = video.getBoundingClientRect()
  let dragPosition: typeof appearance.position | null = null
  const host = document.createElement("div")
  host.dataset.readomiSubtitles = ""
  host.className = "notranslate"
  host.setAttribute("translate", "no")
  const shadow = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = `:host{position:fixed!important;z-index:2147483646!important;pointer-events:none!important;display:block!important;width:max-content!important;transform:translate(-50%,-100%)!important}.box{position:relative;max-width:100%;box-sizing:border-box;font-family:system-ui;pointer-events:auto;touch-action:none;user-select:none;cursor:grab;outline:none}.box:focus-visible{outline:2px solid #fff8;outline-offset:6px}.box.dragging{cursor:grabbing}.original{font-size:.85em;margin-bottom:4px}.translated{font-size:1em}.empty{display:none}`
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
  const youtubeCaptionPosition = youtubePlayer ? createYouTubeCaptionPosition(youtubePlayer) : null
  // Hide only this player's original captions. Restoration removes this style.
  const playerId = getRandomUUID()
  if (youtubePlayer) {
    youtubePlayer.setAttribute("data-readomi-caption-player", playerId)
    nativeStyle.textContent = `[data-readomi-caption-player="${playerId}"] .ytp-caption-window-container{visibility:hidden!important}`
    youtubePlayer.append(nativeStyle)
  }
  const xPlayer = isXHost()
  const tracks = createTextTrackSession(video, track => !xPlayer || track.label !== "clone")
  const timeline = youtubePlayer ? createYouTubeTimeline() : null
  const targets = new Map<string, LangCodeISO6393>()
  let translationGeneration = 0
  let requestController = new AbortController()
  const translations = new SubtitleTranslationWindow(async (input) => {
    const provider = config.providersConfig.find(p => p.id === config.translate.providerId)
    if (!provider?.apiKey?.trim())
      throw new Error("Translation service is not configured")
    const generation = translationGeneration
    return translateTextCore({
      text: input,
      langConfig: config.language,
      providerConfig: provider,
      extraHashTags: ["video-subtitles"],
      customPromptsConfig: config.translate.customPromptsConfig,
      signal: requestController.signal,
      onTargetLanguage: (code) => {
        if (disposed || generation !== translationGeneration)
          return
        if (targets.size >= 1000)
          targets.delete(targets.keys().next().value!)
        targets.set(input, code)
      },
    })
  })
  const resetTranslations = () => {
    translationGeneration++
    requestController.abort()
    requestController = new AbortController()
    targets.clear()
    translations.reset()
  }
  let timelineKey = ""
  let nativeCues = [] as ReturnType<typeof readTrackCues>
  let cueCount = -1
  let track: TextTrack | undefined
  let trackKey = ""
  let source = ""
  let text = ""
  let changedAt = 0
  let state: SubtitleStatus["state"] = "waiting"
  const positionCaption = () => {
    const videoRect = video.getBoundingClientRect()
    const videoSize = subtitleVideoSize(video, videoRect)
    box.style.fontSize = `${resolveSubtitleFontSize(appearance, videoSize.width, videoSize.height)}px`
    const playerRect = !dragPosition && subtitlePositionName(appearance.position) === "bottom" ? youtubePlayer?.getBoundingClientRect() : undefined
    const rect = playerRect && playerRect.width > 0 && playerRect.height > 0 ? playerRect : videoRect
    renderedRect = rect
    host.style.maxWidth = `${rect.width * 0.8}px`
    const bottomEdge = subtitlePositionName(appearance.position) === "bottom" ? youtubeCaptionPosition?.bottom(rect) ?? (xPlayer ? xCaptionBottom(video, rect, box.matches(":hover, :focus-within")) : undefined) : undefined
    renderedPosition = dragPosition ?? resolveSubtitlePosition(appearance.position, rect, box.getBoundingClientRect(), bottomEdge)
    const centre = rect.width * renderedPosition.x / 100
    host.style.left = `${rect.left + centre}px`
    host.style.top = `${rect.top + rect.height * renderedPosition.y / 100}px`
  }
  // Fixed captions need to follow viewport geometry at scroll speed, separate
  // from the slower caption and translation polling.
  const schedulePosition = () => {
    if (disposed || positionFrame !== undefined || !view)
      return
    positionFrame = view.requestAnimationFrame(() => {
      positionFrame = undefined
      if (!disposed && video.isConnected && host.isConnected)
        positionCaption()
    })
  }
  view?.addEventListener("scroll", schedulePosition, { capture: true, passive: true })
  view?.addEventListener("resize", schedulePosition)
  const renderAppearance = () => {
    box.setAttribute("aria-label", i18n.t("subtitleStyle.dragHint"))
    box.title = i18n.t("subtitleStyle.dragHint")
    Object.assign(box.style, subtitleTextStyle(appearance))
    positionCaption()
  }
  const persist = (patch: Partial<SubtitleStyle>) => onStyleChange(patch)
  renderAppearance()
  const disposeDrag = bindSubtitleDrag(box, {
    videoRect: () => video.getBoundingClientRect(),
    position: () => {
      const rect = video.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0)
        return appearance.position
      return {
        x: (renderedRect.left + renderedRect.width * renderedPosition.x / 100 - rect.left) / rect.width * 100,
        y: (renderedRect.top + renderedRect.height * renderedPosition.y / 100 - rect.top) / rect.height * 100,
      }
    },
    move: (position) => {
      dragPosition = position
      positionCaption()
    },
    commit: (position) => {
      dragPosition = null
      persist({ position })
    },
    cancel: () => {
      dragPosition = null
      positionCaption()
    },
  })

  const tick = () => {
    if (xPlayer)
      video.dataset.readomiXSubtitlePage = location.pathname
    const fullscreen = document.fullscreenElement
    if (fullscreen && fullscreen !== video && fullscreen.contains(video)) {
      if (host.parentElement !== fullscreen)
        fullscreen.append(host)
    }
    else if (host.parentElement !== document.documentElement) {
      document.documentElement.append(host)
    }
    const rect = video.getBoundingClientRect()
    const currentSource = `${xPlayer ? xVideoIdentity(video) : location.href}|${video.currentSrc || video.src}`
    if (currentSource !== source) {
      source = currentSource
      text = ""
      resetTranslations()
      timelineKey = ""
      nativeCues = []
      cueCount = -1
      tracks.reset()
      track = undefined
      trackKey = ""
    }
    const selected = tracks.sync()
    const selectedKey = selected ? `${selected.kind}|${selected.language}|${selected.label}` : ""
    if (selected !== track || selectedKey !== trackKey) {
      track = selected
      trackKey = selectedKey
      resetTranslations()
      nativeCues = []
      cueCount = -1
      text = ""
    }
    const youtube = timeline?.tick()
    if (youtube && youtube.key !== timelineKey) {
      timelineKey = youtube.key
      resetTranslations()
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
    const result = translations.get(text)
    state = youtube?.enabled === false
      ? "disabled"
      : !track && !cues.length && !youtubeText
          ? youtubePlayer && youtube?.enabled === null ? "waiting" : "missing"
          : !text || adPlaying || video.ended
              ? "waiting"
              : translations.hasFailed(text)
                ? "failed"
                : result !== undefined
                  ? "ready"
                  : Date.now() - changedAt >= 5000 ? "delayed" : "waiting"
    const preserved = result !== undefined && (result.trim() === "" || prepareTranslationText(result) === prepareTranslationText(text))
    const showOriginal = config.features.subtitleMode === "bilingual" || preserved || result === undefined
    original.textContent = showOriginal ? text : ""
    original.hidden = !showOriginal
    original.style.marginBottom = preserved ? "0" : ""
    translated.hidden = preserved
    translated.textContent = preserved ? "" : result ?? (translations.hasFailed(text) ? i18n.t("subtitleTranslation.failed") : i18n.t(cues.length ? "subtitleTranslation.prefetching" : "subtitleTranslation.pending"))
    setTranslationDirAndLang(translated, targets.get(text) ?? config.language.targetCode)
    positionCaption()
    if (adPlaying || video.ended || youtube?.enabled === false) {
      translations.update([], video.currentTime, video.playbackRate, "")
      return
    }
    // Known timeline cues are stable; only DOM captions need the settling delay.
    translations.update(cues, video.currentTime, video.playbackRate, visible && (cues.length || Date.now() - changedAt >= 300) ? text : "")
  }
  return {
    status: () => state,
    retry: () => {
      translations.clearFailures()
      tick()
    },
    tick,
    updateConfig: (next) => {
      if (config.translate.providerId !== next.translate.providerId)
        translations.clearFailures()
      config = next
      appearance = next.features.subtitleStyle
      renderAppearance()
      tick()
    },
    dispose: () => {
      disposed = true
      requestController.abort()
      targets.clear()
      view?.removeEventListener("scroll", schedulePosition, true)
      view?.removeEventListener("resize", schedulePosition)
      if (positionFrame !== undefined)
        view?.cancelAnimationFrame(positionFrame)
      disposeDrag()
      timeline?.dispose()
      translations.dispose()
      tracks.dispose()
      if (xPlayer)
        delete video.dataset.readomiXSubtitlePage
      host.remove()
      nativeStyle.remove()
      youtubeCaptionPosition?.dispose()
      if (youtubePlayer?.getAttribute("data-readomi-caption-player") === playerId)
        youtubePlayer.removeAttribute("data-readomi-caption-player")
    },
  }
}

/** Allowed sites keep controls while the caption session is off or between cues. */
function mountPlayer(video: HTMLVideoElement, initialConfig: Config, initialEnabled: boolean, initialExcluded: boolean, onToggle: (enabled: boolean) => void): Player {
  let config = initialConfig
  let lastStoredConfig = initialConfig
  let enabled = initialEnabled
  let excluded = initialExcluded
  let renderer: SubtitleRenderer | null = null
  let disposed = false
  let savedAppearance = config.features.subtitleStyle
  let saveGeneration = 0
  const pendingAppearance = new Map<number, Partial<SubtitleStyle>>()
  let controls: VideoTranslationControls | null = null
  const syncControls = () => {
    if (config.features.videoControls && !excluded && shouldShowVideoControls(video)) {
      controls ??= createVideoTranslationControls(video, {
        enabled,
        appearance: config.features.subtitleStyle,
        onToggle,
        onStyleChange: persist,
      })
    }
    else {
      controls?.dispose()
      controls = null
    }
  }
  const render = () => {
    syncControls()
    controls?.update({ enabled, appearance: config.features.subtitleStyle })
    if (enabled && !excluded) {
      renderer ??= mountSubtitleRenderer(video, config, persist)
      renderer.updateConfig(config)
    }
    else {
      renderer?.dispose()
      renderer = null
    }
  }
  const applyPendingAppearance = () => {
    const subtitleStyle = Array.from(pendingAppearance.values()).reduce<SubtitleStyle>((style, patch) => ({ ...style, ...patch }), savedAppearance)
    config = { ...config, features: { ...config.features, subtitleStyle } }
  }
  function persist(patch: Partial<SubtitleStyle>) {
    if (disposed || !isExtensionContextValid())
      return
    const generation = ++saveGeneration
    pendingAppearance.set(generation, patch)
    applyPendingAppearance()
    controls?.update({ saveFailed: false })
    render()
    void saveSubtitleStyle(patch).then(() => {
      if (disposed)
        return
      savedAppearance = { ...savedAppearance, ...patch }
      pendingAppearance.delete(generation)
      applyPendingAppearance()
      render()
    }).catch((error) => {
      pendingAppearance.delete(generation)
      if (disposed || !isExtensionContextValid() || isExtensionContextInvalidatedError(error))
        return
      applyPendingAppearance()
      render()
      if (generation === saveGeneration) {
        controls?.update({ saveFailed: true })
      }
      logger.error("Could not save subtitle appearance", error)
    })
  }
  render()
  return {
    status: () => ({ hasVideo: true, state: excluded ? "excluded" : !enabled ? "off" : renderer?.status() ?? "waiting" }),
    retry: () => renderer?.retry(),
    tick: () => {
      syncControls()
      controls?.tick()
      renderer?.tick()
    },
    updateConfig: (next, nextEnabled, nextExcluded, storedChange = false) => {
      if (!storedChange && lastStoredConfig === next && enabled === nextEnabled && excluded === nextExcluded)
        return
      if (storedChange || lastStoredConfig !== next) {
        // A service switch applies to the next request. Keep captions already
        // translated or in flight so changing services does not interrupt playback.
        const serviceSwitched = config.translate.providerId !== next.translate.providerId
        if (subtitleRequestKey(config, serviceSwitched) !== subtitleRequestKey(next, serviceSwitched)) {
          renderer?.dispose()
          renderer = null
        }
        config = next
        lastStoredConfig = next
        savedAppearance = next.features.subtitleStyle
        applyPendingAppearance()
      }
      enabled = nextEnabled
      excluded = nextExcluded
      render()
    },
    dispose: () => {
      disposed = true
      controls?.dispose()
      renderer?.dispose()
      renderer = null
    },
  }
}

function subtitleRequestKey(config: Config, omitProvider = false): string {
  return JSON.stringify([
    config.language,
    omitProvider ? null : config.providersConfig.find(provider => provider.id === config.translate.providerId),
    config.translate.customPromptsConfig,
  ])
}

/** Session switches belong to a video, and reset when that element plays another source. */
function videoSessionKey(video: HTMLVideoElement): string {
  const source = video.currentSrc || video.src
  if (isXHost())
    return `${xVideoIdentity(video)}|${source}`
  const url = new URL(location.href)
  if (video.closest(".html5-video-player")) {
    const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]
    if (id)
      return `youtube:${id}`
  }
  return source || `${url.origin}${url.pathname}`
}

export function bootstrapVideoSubtitles(isContextInvalid: () => boolean = () => false) {
  const players = new Map<HTMLVideoElement, Player>()
  let overrides = new WeakMap<HTMLVideoElement, { key: string, enabled: boolean }>()
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
  const tick = (storedChange = false) => {
    const config = current
    if (disposed || isContextInvalid() || !config)
      return
    const excluded = isVideoTranslationExcluded(location.href, config.features.videoExcludedSites)
    if (excluded)
      overrides = new WeakMap()
    const xVideo = isXHost() ? currentXVideo() : null
    const videos = isXHost() ? (xVideo ? [xVideo] : []) : Array.from(document.querySelectorAll("video"))
    for (const [video, player] of players) {
      if (!video.isConnected || !videos.includes(video)) {
        player.dispose()
        players.delete(video)
      }
    }
    for (const video of videos) {
      const session = overrides.get(video)
      if (session && session.key !== videoSessionKey(video))
        overrides.delete(video)
      const enabled = !excluded && (overrides.get(video)?.enabled ?? (config.features.videoSubtitles && !suspended))
      if (!players.has(video)) {
        players.set(video, mountPlayer(video, config, enabled, excluded, (nextEnabled) => {
          if (disposed || isContextInvalid() || !current || isVideoTranslationExcluded(location.href, current.features.videoExcludedSites))
            return
          overrides.set(video, { key: videoSessionKey(video), enabled: nextEnabled })
          players.get(video)?.updateConfig(current, nextEnabled, false)
          players.get(video)?.tick()
        }))
      }
      else {
        players.get(video)!.updateConfig(config, enabled, excluded, storedChange)
      }
    }
    players.forEach(player => player.tick())
  }
  const unsubscribeStatus = onMessage("getSubtitleStatus", () => {
    if (disposed || isContextInvalid())
      return NO_VIDEO_STATUS
    tick()
    const videos = [...players.keys()].filter((video) => {
      const rect = video.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }).sort((a, b) => Number(a.paused) - Number(b.paused) || b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)
    return videos.length ? players.get(videos[0])!.status() : NO_VIDEO_STATUS
  })
  const unsubscribeRetry = onMessage("retrySubtitleTranslation", () => {
    if (!disposed && !isContextInvalid())
      players.forEach(player => player.retry())
  })
  const unsubscribe = subscribeLocalConfig((config) => {
    if (disposed || isContextInvalid())
      return
    const previous = current
    current = config
    if (previous?.features.videoSubtitles !== config?.features.videoSubtitles) {
      overrides = new WeakMap()
      suspended = false
    }
    if (!config) {
      reset()
      return
    }
    tick(true)
    timer ??= setInterval(tick, 250)
  })
  const keydown = (event: KeyboardEvent) => {
    if (disposed || isContextInvalid())
      return
    if (!current?.features.videoSubtitles || event.defaultPrevented || event.repeat || isEditableTarget(event.target) || !eventMatchesHotkey(event, current.features.subtitlesShortcut))
      return
    if (isVideoTranslationExcluded(location.href, current.features.videoExcludedSites))
      return
    event.preventDefault()
    event.stopPropagation()
    suspended = !suspended
    overrides = new WeakMap()
    tick()
  }
  document.addEventListener("keydown", keydown, true)
  return () => {
    disposed = true
    unsubscribeStatus()
    unsubscribeRetry()
    document.removeEventListener("keydown", keydown, true)
    unsubscribe()
    reset()
  }
}
