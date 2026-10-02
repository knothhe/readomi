export const YOUTUBE_SUBTITLE_REQUEST = "readomi:youtube-subtitle-request"
export const YOUTUBE_SUBTITLE_RESPONSE = "readomi:youtube-subtitle-response"

interface CaptionTrack {
  baseUrl?: string
  languageCode?: string
  vssId?: string
  kind?: string
  translationLanguage?: { languageCode?: string }
}
interface YouTubePlayer extends HTMLElement {
  getAudioTrack?: () => { captionTracks?: { vssId?: string, languageCode?: string, kind?: string, url?: string }[] }
  getWebPlayerContextConfig?: () => { innertubeContextClientVersion?: string }
  getOption?: (module: string, option: string) => CaptionTrack | undefined
  getPlayerResponse?: () => {
    videoDetails?: { videoId?: string, isLiveContent?: boolean }
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } }
  }
}

function timedtextUrl(value: string): URL | null {
  try {
    const url = new URL(value, location.href)
    return (url.hostname === "www.youtube.com" || url.hostname === "www.youtube-nocookie.com") && url.pathname === "/api/timedtext" ? url : null
  }
  catch {
    return null
  }
}

/** Keep parsing out of YouTube's page world, whose Trusted Types policy forbids DOMParser. */
function transcriptBody(body: string): string {
  if (!body.trim() || body.length > 5_000_000)
    return ""
  try {
    return Array.isArray(JSON.parse(body).events) ? body : ""
  }
  catch {
    return /^\s*(?:<\?xml[^>]*>\s*)?<(?:transcript|timedtext)\b/.test(body) ? body : ""
  }
}

/** Runs in the page world. Only subtitle text crosses the bridge, never provider credentials. */
export function installYouTubeSubtitleBridge() {
  const observed = new Map<string, URL>()
  const captured = new Map<string, { url: URL, body: string }>()
  const transcripts = new Map<string, string>()
  const failures = new Map<string, { at: number, url: string }>()
  const inflight = new Map<string, Promise<string>>()
  const nativeFetch = window.fetch.bind(window)
  const observe = (value: string) => {
    const url = timedtextUrl(value)
    if (!url?.searchParams.get("v"))
      return
    const key = ["v", "lang", "kind", "tlang", "name"].map(p => url.searchParams.get(p) ?? "").join("|")
    observed.delete(key)
    observed.set(key, url)
    if (observed.size > 20)
      observed.delete(observed.keys().next().value!)
  }
  const capture = (url: URL, body: string) => {
    const transcript = transcriptBody(body)
    if (!transcript)
      return
    captured.set(url.href, { url, body: transcript })
    if (captured.size > 6)
      captured.delete(captured.keys().next().value!)
  }
  // Keep the signed URL the player actually uses (including its proof token).
  // Observe a clone of successful responses; the player's body remains untouched.
  const wrappedFetch: typeof fetch = (input, init) => {
    const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    observe(value)
    const url = timedtextUrl(value)
    const result = nativeFetch(input, init)
    if (url) {
      void result.then(async (response) => {
        if (response.ok && response.clone)
          capture(url, await response.clone().text())
      }).catch(() => {})
    }
    return result
  }
  window.fetch = wrappedFetch
  const xhrUrls = new WeakMap<XMLHttpRequest, URL>()
  const watched = new WeakSet<XMLHttpRequest>()
  const nativeOpen = XMLHttpRequest.prototype.open
  const wrappedOpen: typeof nativeOpen = function (this: XMLHttpRequest, method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
    observe(String(url))
    const parsed = timedtextUrl(String(url))
    if (parsed)
      xhrUrls.set(this, parsed)
    else
      xhrUrls.delete(this)
    if (!watched.has(this)) {
      watched.add(this)
      this.addEventListener("load", () => {
        const source = xhrUrls.get(this)
        if (!source || this.status < 200 || this.status >= 300)
          return
        try {
          if (!this.responseType || this.responseType === "text")
            capture(source, this.responseText)
          else if (this.responseType === "json")
            capture(source, JSON.stringify(this.response))
        }
        catch {}
      })
    }
    nativeOpen.call(this, method, url, async, username, password)
  }
  XMLHttpRequest.prototype.open = wrappedOpen

  const getTranscript = async (key: string, url: URL) => {
    if (transcripts.has(key))
      return transcripts.get(key)!
    const failure = failures.get(key)
    if (failure && failure.url === url.href && failure.at > Date.now() - 10_000)
      return ""
    const pending = inflight.get(key)
    if (pending)
      return pending
    const load = async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const response = await nativeFetch(url.href, { credentials: "include", signal: controller.signal })
        const body = response.ok ? transcriptBody(await response.text()) : ""
        if (body) {
          transcripts.set(key, body)
          if (transcripts.size > 6)
            transcripts.delete(transcripts.keys().next().value!)
        }
        else {
          failures.set(key, { at: Date.now(), url: url.href })
        }
        return body
      }
      catch {
        failures.set(key, { at: Date.now(), url: url.href })
        return ""
      }
      finally {
        clearTimeout(timeout)
        inflight.delete(key)
      }
    }
    const promise = load()
    inflight.set(key, promise)
    return promise
  }
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== YOUTUBE_SUBTITLE_REQUEST || typeof event.data.requestId !== "string" || typeof event.data.videoId !== "string")
      return
    const { requestId, videoId, knownKey } = event.data
    const respond = (data: object) => window.postMessage({ type: YOUTUBE_SUBTITLE_RESPONSE, requestId, videoId, ...data }, location.origin)
    void (async () => {
      const player = Array.from(document.querySelectorAll<YouTubePlayer>(".html5-video-player")).find(p => p.getPlayerResponse?.().videoDetails?.videoId === videoId)
      const response = player?.getPlayerResponse?.()
      if (response?.videoDetails?.videoId !== videoId || response?.videoDetails?.isLiveContent) {
        respond({ key: "", cues: [], enabled: null })
        return
      }
      const selected = player?.getOption?.("captions", "track")
      if (!selected?.languageCode && !selected?.vssId) {
        respond({ key: "", cues: [], enabled: player?.getOption ? false : null })
        return
      }
      const track = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.find(t => selected.vssId ? t.vssId === selected.vssId : t.languageCode === selected.languageCode && (t.kind ?? "") === (selected.kind ?? ""))
      if (!track?.baseUrl) {
        respond({ key: "", cues: [], enabled: true })
        return
      }
      for (const entry of performance.getEntriesByType("resource"))
        observe(entry.name)
      const base = timedtextUrl(track.baseUrl)
      if (!base || base.searchParams.get("v") !== videoId) {
        respond({ key: "", cues: [], enabled: true })
        return
      }
      const target = selected.translationLanguage?.languageCode ?? base.searchParams.get("tlang") ?? ""
      const actual = Array.from(observed.values()).reverse().find(url => url.searchParams.get("v") === videoId && url.searchParams.get("lang") === track.languageCode && (url.searchParams.get("kind") ?? "") === (track.kind ?? "") && (url.searchParams.get("tlang") ?? "") === target)
      const url = new URL((actual ?? base).href)
      if (target)
        url.searchParams.set("tlang", target)
      const audio = player?.getAudioTrack?.()?.captionTracks?.find(t => t.vssId === track.vssId)
      const proofUrl = audio?.url ? timedtextUrl(audio.url) : null
      for (const param of ["pot", "potc"]) {
        if (!url.searchParams.has(param) && proofUrl?.searchParams.has(param))
          url.searchParams.set(param, proofUrl.searchParams.get(param)!)
      }
      for (const [param, value] of Object.entries({ fmt: "json3", xorb: "2", xobt: "3", xovt: "3", c: "WEB", cplayer: "UNIPLAYER" }))
        url.searchParams.set(param, value)
      const version = player?.getWebPlayerContextConfig?.()?.innertubeContextClientVersion
      if (version && !url.searchParams.has("cver"))
        url.searchParams.set("cver", version)
      const key = `${videoId}|${track.vssId ?? track.languageCode}|${url.searchParams.get("tlang") ?? ""}`
      const received = Array.from(captured.values()).reverse().find(item => ["v", "lang", "kind", "tlang", "name"].every(param => (item.url.searchParams.get(param) ?? "") === (url.searchParams.get(param) ?? "")))
      if (received) {
        transcripts.set(key, received.body)
        if (transcripts.size > 6)
          transcripts.delete(transcripts.keys().next().value!)
      }
      const transcript = await getTranscript(key, url)
      const current = player?.getOption?.("captions", "track")
      if (player?.getPlayerResponse?.().videoDetails?.videoId !== videoId || current?.vssId !== selected.vssId || current?.languageCode !== selected.languageCode || current?.translationLanguage?.languageCode !== selected.translationLanguage?.languageCode) {
        respond({ key: "", cues: [], enabled: null })
        return
      }
      respond({ key, enabled: true, ...(knownKey === key && transcript ? {} : { transcript }) })
    })().catch(() => respond({ key: "", cues: [], enabled: null }))
  }
  window.addEventListener("message", onMessage)
  return () => {
    window.removeEventListener("message", onMessage)
    if (window.fetch === wrappedFetch)
      window.fetch = nativeFetch
    if (XMLHttpRequest.prototype.open === wrappedOpen)
      XMLHttpRequest.prototype.open = nativeOpen
  }
}
