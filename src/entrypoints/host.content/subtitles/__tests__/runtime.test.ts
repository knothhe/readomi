// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { PageSubtitleState } from "@/types/page-subtitle-state"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { sendMessage } from "@/utils/message"
import * as appearance from "@/utils/subtitles/appearance"
import { translateSubtitleBatch } from "@/utils/subtitles/translation-batch"
import { bootstrapVideoSubtitles, readActiveCueText } from "../runtime"

const statusHandlers = vi.hoisted(() => new Map<string, (message?: { data: PageSubtitleState }) => unknown>())
vi.mock("@/utils/message", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/utils/message")>()
  return { ...original, sendMessage: vi.fn(() => Promise.resolve(undefined)), onMessage: (type: string, handler: () => unknown) => {
    statusHandlers.set(type, handler)
    return () => statusHandlers.delete(type)
  } }
})

let update: (config: Config | null) => void
vi.mock("@/utils/config/storage", () => ({ subscribeLocalConfig: (callback: typeof update) => {
  update = callback
  return vi.fn()
} }))
vi.mock("@/utils/host/translate/translate-text", () => ({ translateTextCore: vi.fn() }))
vi.mock("@/utils/subtitles/translation-batch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/subtitles/translation-batch")>()
  return { ...actual, translateSubtitleBatch: vi.fn(async (options: Parameters<typeof actual.translateSubtitleBatch>[0], signal: AbortSignal) => Promise.all(options.items.map(async item => ({ id: item.id, result: { action: "translate", text: await translateTextCore({ text: item.text, langConfig: options.langConfig, providerConfig: options.providerConfig, customPromptsConfig: options.customPromptsConfig, signal }) } })))) }
})
let youtube = { key: "", cues: [] as { start: number, end: number, text: string }[], enabled: null as boolean | null }
vi.mock("@/utils/subtitles/youtube-client", () => ({ createYouTubeTimeline: () => ({ tick: () => youtube, dispose: vi.fn() }) }))
let shadow: ShadowRoot
let controlsShadow: ShadowRoot
let cleanup: () => void
let track: { kind: string, mode: string, activeCues: { text: string }[] }
let video: HTMLVideoElement
const config: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoSubtitles: true }, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "local" })) }

function attachYouTubePlayer(target = video) {
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=unit"))
  let main = document.querySelector("#movie_player")
  if (!main) {
    main = document.createElement("main")
    main.id = "movie_player"
    document.body.append(main)
  }
  const player = document.createElement("div")
  player.className = "html5-video-player"
  main.append(player)
  player.append(target)
  return player
}

function attachXPlayer() {
  vi.stubGlobal("location", new URL("https://x.com/example/status/100"))
  const article = document.createElement("article")
  article.innerHTML = "<div data-testid='videoComponent'></div>"
  document.body.append(article)
  article.querySelector("div")!.append(video)
}
beforeEach(() => {
  vi.useFakeTimers()
  youtube = { key: "", cues: [], enabled: null }
  const attach = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, options) {
    const root = attach.call(this, options)
    if (this.hasAttribute("data-readomi-video-controls"))
      controlsShadow = root
    else if (this.hasAttribute("data-readomi-subtitles"))
      shadow = root
    return root
  })
  document.body.innerHTML = "<video></video>"
  video = document.querySelector("video")!
  track = { kind: "subtitles", mode: "showing", activeCues: [{ text: "Hello" }] }
  Object.defineProperty(video, "textTracks", { value: [track] })
  Object.defineProperty(video, "paused", { value: false, configurable: true })
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 640, height: 360 } as DOMRect)
  vi.mocked(translateTextCore).mockResolvedValue("你好")
  cleanup = bootstrapVideoSubtitles()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("local subtitle runtime", () => {
  it("enables subtitles with macOS Option+V even when the saved default is off", () => {
    update(DEFAULT_CONFIG)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "√", code: "KeyV", altKey: true, cancelable: true }))
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBeNull()
    expect(sendMessage).toHaveBeenCalledWith("setPageSubtitleState", { url: location.href, enabled: true })
    expect(DEFAULT_CONFIG.features.videoSubtitles).toBe(false)
  })
  it("inverts the actual player switch and reflects a popup choice in the player", () => {
    attachYouTubePlayer()
    update(config)
    const toggle = () => controlsShadow.querySelector<HTMLButtonElement>(".toggle")!
    toggle().click()
    expect(toggle()).toHaveAttribute("aria-pressed", "false")
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "√", code: "KeyV", altKey: true, cancelable: true }))
    expect(toggle()).toHaveAttribute("aria-pressed", "true")
    statusHandlers.get("applyPageSubtitleState")!({ data: { url: location.href, enabled: false, available: true, overridden: true } })
    expect(toggle()).toHaveAttribute("aria-pressed", "false")
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(track.mode).toBe("showing")
    expect(config.features.videoSubtitles).toBe(true)
  })
  it("does not let an initial read undo a newer local switch", async () => {
    let resolve!: (state: PageSubtitleState) => void
    vi.mocked(sendMessage).mockImplementationOnce(() => new Promise(done => resolve = done))
    update(DEFAULT_CONFIG)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", altKey: true, cancelable: true }))
    resolve({ url: location.href, enabled: false, available: true, overridden: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBeNull()
  })
  it("translates video captions without an API key when explicitly configured", async () => {
    const local: Config = { ...config, providersConfig: config.providersConfig.map(p => ({ ...p, apiKey: undefined, noApiKey: true })) }
    update(local)
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ providerConfig: expect.objectContaining({ noApiKey: true, apiKey: undefined }) }))
    expect(shadow.querySelector(".translated")!.textContent).toBe("你好")
  })

  it("updates the original ratio live without changing translated text, base size or position", async () => {
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    const box = shadow.querySelector<HTMLElement>(".box")!
    const translated = shadow.querySelector(".translated")!.textContent
    const fontSize = box.style.fontSize
    expect(box.style.getPropertyValue("--readomi-original-font-scale")).toBe("1em")
    for (const originalFontScale of [85, 125, 100]) {
      update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, originalFontScale } } })
      await vi.advanceTimersByTimeAsync(1000)
      expect(box.style.getPropertyValue("--readomi-original-font-scale")).toBe(`${originalFontScale / 100}em`)
      expect(box.style.fontSize).toBe(fontSize)
      expect(shadow.querySelector(".translated")!.textContent).toBe(translated)
      expect(config.features.subtitleStyle.position).toEqual(DEFAULT_CONFIG.features.subtitleStyle.position)
    }
    expect(translateTextCore).toHaveBeenCalledTimes(1)
  })
  it("reports the detected player's state and restores original captions while waiting or failing in translation-only mode", async () => {
    const read = () => statusHandlers.get("getSubtitleStatus")!()
    update(DEFAULT_CONFIG)
    expect(read()).toEqual({ hasVideo: true, state: "off" })
    vi.mocked(translateTextCore).mockReturnValue(new Promise(() => {}))
    update({ ...config, features: { ...config.features, subtitleMode: "translationOnly" } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(read()).toEqual({ hasVideo: true, state: "waiting" })
    expect(shadow.querySelector<HTMLElement>(".original")!.hidden).toBe(false)
    expect(shadow.querySelector(".original")!.textContent).toBe("Hello")
    await vi.advanceTimersByTimeAsync(5000)
    expect(read()).toEqual({ hasVideo: true, state: "delayed" })
    // Replace the language to discard the pending cue and exercise a failure.
    vi.mocked(translateTextCore).mockRejectedValue(new Error("network failure"))
    update({ ...config, language: { ...config.language, targetCode: "eng" }, features: { ...config.features, subtitleMode: "translationOnly" } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(read()).toEqual({ hasVideo: true, state: "failed" })
    expect(shadow.querySelector<HTMLElement>(".original")!.hidden).toBe(false)
    vi.mocked(translateTextCore).mockResolvedValue("Recovered caption")
    statusHandlers.get("retrySubtitleTranslation")!()
    await vi.advanceTimersByTimeAsync(1000)
    expect(read()).toEqual({ hasVideo: true, state: "ready" })
    expect(shadow.querySelector(".translated")!.textContent).toBe("Recovered caption")
    expect(shadow.querySelector<HTMLElement>(".original")!.hidden).toBe(true)
    video.remove()
    expect(read()).toEqual({ hasVideo: false, state: "off" })
  })

  it.each(["bilingual", "translationOnly"] as const)("shows preserved original once in %s mode", async (subtitleMode) => {
    track.activeCues = [{ text: "原文保持可读。" }]
    vi.mocked(translateTextCore).mockResolvedValue("")
    update({ ...config, language: { ...config.language, secondaryCode: "original" }, features: { ...config.features, subtitleMode } })
    await vi.advanceTimersByTimeAsync(1000)
    const original = shadow.querySelector<HTMLElement>(".original")!
    const translated = shadow.querySelector<HTMLElement>(".translated")!
    expect(original.hidden).toBe(false)
    expect(original.textContent).toBe("原文保持可读。")
    expect(translated.hidden).toBe(true)
    expect(translated.textContent).toBe("")
    expect(shadow.querySelector(".box")!.textContent).toBe("原文保持可读。")
    expect(translateTextCore).toHaveBeenCalledOnce()
  })

  it("uses each cue's actual target language and re-translates after language rules change", async () => {
    track.activeCues = [{ text: "简体中文句段。" }]
    vi.mocked(translateTextCore).mockImplementation(async ({ onTargetLanguage }) => {
      onTargetLanguage?.("arb")
      return "جملة مترجمة."
    })
    update({ ...config, language: { ...config.language, secondaryCode: "arb" } })
    await vi.advanceTimersByTimeAsync(1000)
    const translated = () => shadow.querySelector<HTMLElement>(".translated")!
    expect(translated().dir).toBe("rtl")
    expect(translated().lang).toBe("ar")

    vi.mocked(translateTextCore).mockImplementation(async ({ onTargetLanguage }) => {
      onTargetLanguage?.("eng")
      return "A translated sentence."
    })
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    expect(translated().textContent).toBe("A translated sentence.")
    expect(translated().dir).toBe("ltr")
    expect(translated().lang).toBe("en")
    expect(translateTextCore).toHaveBeenCalledTimes(2)
  })

  it("offers a session switch even when disabled globally and restores native captions on off", async () => {
    attachYouTubePlayer()
    update(DEFAULT_CONFIG)
    const controlsHost = document.querySelector("[data-readomi-video-controls]")
    const toggle = () => controlsShadow.querySelector<HTMLButtonElement>(".toggle")!
    expect(document.querySelector("[data-readomi-video-controls]")).not.toBeNull()
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(track.mode).toBe("showing")
    toggle().click()
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBeNull()
    expect(track.mode).toBe("hidden")
    toggle().click()
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(document.querySelector("[data-readomi-video-controls]")).toBe(controlsHost)
    expect(toggle()).toHaveAttribute("aria-label", "videoTranslationControls.enable")
    expect(track.mode).toBe("showing")
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).not.toHaveBeenCalled()
    expect(DEFAULT_CONFIG.features.videoSubtitles).toBe(false)
  })
  it("keeps all videos on the page disabled after a toolbar switch and style updates", async () => {
    attachYouTubePlayer()
    const second = document.createElement("video")
    const secondTrack = { kind: "subtitles", mode: "showing", activeCues: [{ text: "Another video" }] }
    Object.defineProperty(second, "textTracks", { value: [secondTrack] })
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({ left: 0, top: 400, width: 640, height: 360 } as DOMRect)
    document.body.append(second)
    attachYouTubePlayer(second)
    update(config)
    controlsShadow.querySelector<HTMLButtonElement>("button[aria-label='videoTranslationControls.disable']")!.click()
    expect(secondTrack.mode).toBe("showing")
    expect(track.mode).toBe("showing")
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, preset: "compact" } } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelectorAll("[data-readomi-subtitles]")).toHaveLength(0)
    expect(translateTextCore).not.toHaveBeenCalled()
  })
  it("resets the page switch for a new page and ignores late results after switching off", async () => {
    attachXPlayer()
    let resolve!: (value: string) => void
    vi.mocked(translateTextCore).mockReturnValue(new Promise(r => resolve = r))
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    controlsShadow.querySelector<HTMLButtonElement>("button[aria-label='videoTranslationControls.disable']")!.click()
    resolve("Late translation")
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(track.mode).toBe("showing")
    video.src = "https://example.com/replacement.mp4"
    vi.stubGlobal("location", new URL("https://x.com/example/status/101"))
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBeNull()
    expect(track.mode).toBe("hidden")
    expect(shadow.querySelector(".translated")?.textContent).not.toBe("Late translation")
  })
  it("keeps a YouTube session switch across chapter, time and playlist URL changes", async () => {
    vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=one"))
    const player = document.createElement("div")
    player.className = "html5-video-player"
    player.id = "movie_player"
    document.body.append(player)
    player.append(video)
    update(config)
    controlsShadow.querySelector<HTMLButtonElement>("button[aria-label='videoTranslationControls.disable']")!.click()
    vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=one&t=32&list=abc#chapter"))
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=two"))
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBeNull()
  })
  it.each(["youtube", "x"])("omits controls on an initially excluded %s site and restores one entry when allowed", async (site) => {
    if (site === "youtube")
      attachYouTubePlayer()
    else
      attachXPlayer()
    const withRules = { ...config, features: { ...config.features, videoExcludedSites: [{ type: "domain" as const, value: site === "youtube" ? "youtube.com" : "x.com" }] } }
    update(withRules)
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(document.querySelector("[data-readomi-controls-anchor]")).toBeNull()
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(track.mode).toBe("showing")
    expect(translateTextCore).not.toHaveBeenCalled()
    update(config)
    const controlsHost = document.querySelector("[data-readomi-video-controls]")
    expect(controlsHost).not.toBeNull()
    expect(controlsShadow.querySelector(".toggle")).toHaveAttribute("aria-pressed", "true")
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBeNull()
    expect(track.mode).toBe("hidden")
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    expect(document.querySelector("[data-readomi-video-controls]")).toBe(controlsHost)
  })
  it.each(["youtube", "x"])("hides and restores %s controls without restarting subtitles or resetting the local switch", async (site) => {
    if (site === "youtube")
      attachYouTubePlayer()
    else
      attachXPlayer()
    const hiddenControls = { ...config, features: { ...config.features, videoControls: false } }
    update(hiddenControls)
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(shadow.querySelector(".translated")).toHaveTextContent("你好")
    const subtitlesHost = document.querySelector("[data-readomi-subtitles]")
    update(config)
    controlsShadow.querySelector<HTMLButtonElement>(".trigger")!.click()
    update(hiddenControls)
    expect(document.querySelector("[data-readomi-video-controls],[data-readomi-controls-anchor]")).toBeNull()
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(subtitlesHost)
    expect(track.mode).toBe("hidden")
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledOnce()
    update(config)
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    expect(controlsShadow.querySelector(".trigger")).toHaveAttribute("aria-expanded", "false")
    controlsShadow.querySelector<HTMLButtonElement>(".toggle")!.click()
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    update(hiddenControls)
    update(config)
    expect(controlsShadow.querySelector(".toggle")).toHaveAttribute("aria-pressed", "false")
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(track.mode).toBe("showing")
  })
  it.each([true, false])("restores the global video default %s after excluding a locally overridden video", async (videoSubtitles) => {
    attachYouTubePlayer()
    const configured = { ...config, features: { ...config.features, videoSubtitles } }
    update(configured)
    controlsShadow.querySelector<HTMLButtonElement>(".toggle")!.click()
    expect(controlsShadow.querySelector(".toggle")).toHaveAttribute("aria-pressed", String(!videoSubtitles))
    expect(!!document.querySelector("[data-readomi-subtitles]")).toBe(!videoSubtitles)

    update({ ...configured, features: { ...configured.features, videoExcludedSites: [{ type: "domain", value: "youtube.com" }] } })
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(track.mode).toBe("showing")

    update(configured)
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    expect(controlsShadow.querySelector(".toggle")).toHaveAttribute("aria-pressed", String(videoSubtitles))
    expect(!!document.querySelector("[data-readomi-subtitles]")).toBe(videoSubtitles)
    expect(track.mode).toBe(videoSubtitles ? "hidden" : "showing")
  })
  it("keeps the page switch while selecting another X video and clears it when excluded", async () => {
    attachXPlayer()
    const mainButton = document.createElement("button")
    mainButton.textContent = "Pause main"
    video.parentElement!.append(mainButton)
    const reply = document.createElement("article")
    reply.innerHTML = "<a href='https://x.com/example/status/200'><time>today</time></a><div data-testid='videoComponent'><video></video><button>Pause reply</button></div>"
    document.body.append(reply)
    const replyVideo = reply.querySelector("video")!
    const replyButton = reply.querySelector<HTMLButtonElement>("button")!
    const replyTrack = { kind: "subtitles", mode: "showing", activeCues: [{ text: "Reply video" }] }
    Object.defineProperty(replyVideo, "textTracks", { value: [replyTrack] })
    vi.spyOn(replyVideo, "getBoundingClientRect").mockReturnValue({ left: 0, top: 400, width: 640, height: 360 } as DOMRect)
    update(config)
    controlsShadow.querySelector<HTMLButtonElement>(".toggle")!.click()
    expect(controlsShadow.querySelector(".toggle")).toHaveAttribute("aria-pressed", "false")
    expect(track.mode).toBe("showing")

    replyButton.focus()
    await vi.advanceTimersByTimeAsync(250)
    expect(replyTrack.mode).toBe("showing")
    expect(track.mode).toBe("showing")
    update({ ...config, features: { ...config.features, videoExcludedSites: [{ type: "domain", value: "x.com" }] } })
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(replyTrack.mode).toBe("showing")
    update(config)
    expect(replyTrack.mode).toBe("hidden")

    mainButton.focus()
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    expect(controlsShadow.querySelector(".toggle")).toHaveAttribute("aria-pressed", "true")
    expect(document.querySelectorAll("[data-readomi-subtitles]")).toHaveLength(1)
    expect(shadow.querySelector(".original")?.textContent).toBe("Hello")
    expect(track.mode).toBe("hidden")
    expect(replyTrack.mode).toBe("showing")
  })
  it("removes an excluded site's open menu and anchor, restores tracks and follows SPA rules", async () => {
    const player = attachYouTubePlayer()
    const nativeControls = document.createElement("div")
    nativeControls.className = "ytp-right-controls"
    player.append(nativeControls)
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    const controlsHost = document.querySelector("[data-readomi-video-controls]")!
    controlsShadow.querySelector<HTMLButtonElement>(".trigger")!.click()
    const panel = controlsShadow.querySelector(".panel")!
    const anchor = nativeControls.querySelector("[data-readomi-controls-anchor]")!
    expect(panel).not.toHaveAttribute("hidden")
    expect(anchor).not.toBeNull()
    expect(controlsHost.parentElement).toBe(document.documentElement)
    const withRules = { ...config, features: { ...config.features, videoExcludedSites: [{ type: "pattern" as const, value: "*.youtube.com/watch" }] } }
    update(withRules)
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(track.mode).toBe("showing")
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(document.querySelector("[data-readomi-controls-anchor]")).toBeNull()
    expect(controlsHost.isConnected).toBe(false)
    expect(panel.isConnected).toBe(false)
    expect(anchor.isConnected).toBe(false)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "v", altKey: true }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledTimes(1)
    vi.stubGlobal("location", new URL("https://www.youtube.com/shorts/other"))
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBeNull()
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    expect(controlsShadow.querySelector(".trigger")).toHaveAttribute("aria-expanded", "false")
    expect(document.querySelector("[data-readomi-controls-anchor]")).toBeNull()
    vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=two"))
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(document.querySelector("[data-readomi-controls-anchor]")).toBeNull()
    expect(track.mode).toBe("showing")
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    expect(controlsShadow.querySelector(".toggle")).toHaveAttribute("aria-pressed", "true")
    expect(controlsShadow.querySelector(".trigger")).toHaveAttribute("aria-expanded", "false")
    expect(document.querySelector("[data-readomi-controls-anchor]")).toBeNull()
    expect(track.mode).toBe("hidden")
  })
  it("rolls back a failed style save without discarding the translation and lets the user retry", async () => {
    attachYouTubePlayer()
    const save = vi.spyOn(appearance, "saveSubtitleStyle").mockRejectedValueOnce(new Error("storage failed")).mockResolvedValue(undefined)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, relativeFontSize: 5 } } })
    await vi.advanceTimersByTimeAsync(1000)
    const host = document.querySelector("[data-readomi-subtitles]")
    const larger = controlsShadow.querySelector<HTMLButtonElement>("button[aria-label='subtitleStyle.larger']")!
    larger.click()
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("18.63px")
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("18px")
    expect(controlsShadow.querySelector(".error[role='status']")?.textContent).toBe("videoTranslationControls.saveFailed")
    larger.click()
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("18.63px")
    expect(save).toHaveBeenCalledTimes(2)
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    expect(translateTextCore).toHaveBeenCalledTimes(1)
  })
  it("keeps the latest size while an earlier save broadcasts and rolls back only the failed write", async () => {
    attachYouTubePlayer()
    let resolveFirst!: () => void
    let rejectSecond!: (error: Error) => void
    vi.spyOn(appearance, "saveSubtitleStyle")
      .mockImplementationOnce(() => new Promise(resolve => resolveFirst = resolve))
      .mockImplementationOnce(() => new Promise((_, reject) => rejectSecond = reject))
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, relativeFontSize: 5 } } })
    const larger = controlsShadow.querySelector<HTMLButtonElement>("button[aria-label='subtitleStyle.larger']")!
    larger.click()
    larger.click()
    expect(Number.parseFloat(shadow.querySelector<HTMLElement>(".box")!.style.fontSize)).toBeCloseTo(19.26)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, relativeFontSize: 5.175 } } })
    resolveFirst()
    await vi.advanceTimersByTimeAsync(250)
    expect(Number.parseFloat(shadow.querySelector<HTMLElement>(".box")!.style.fontSize)).toBeCloseTo(19.26)
    rejectSecond(new Error("Second write failed"))
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("18.63px")
  })
  it("does not mount a newly added video after the extension context expires", async () => {
    cleanup()
    let invalid = false
    cleanup = bootstrapVideoSubtitles(() => invalid)
    update(config)
    expect(document.querySelectorAll("[data-readomi-subtitles]")).toHaveLength(1)
    invalid = true
    document.body.append(document.createElement("video"))
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelectorAll("[data-readomi-subtitles]")).toHaveLength(1)
  })

  it("preserves automatic HTML5 captions outside the toolbar whitelist without mounting controls", async () => {
    vi.stubGlobal("location", new URL("https://www.bilibili.com/video/BVexample"))
    video.controls = true
    update(DEFAULT_CONFIG)
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(track.mode).toBe("showing")
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
    expect(track.mode).toBe("hidden")
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(document.querySelector("[data-readomi-controls-anchor]")).toBeNull()
  })

  it("removes and restores a toolbar when its player leaves the supported context without restarting captions", async () => {
    const player = attachYouTubePlayer()
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    const captionHost = document.querySelector("[data-readomi-subtitles]")
    const controlsHost = document.querySelector("[data-readomi-video-controls]")
    document.body.append(player)
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(controlsHost?.isConnected).toBe(false)
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(captionHost)
    expect(track.mode).toBe("hidden")
    document.querySelector("#movie_player")!.append(player)
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-video-controls]")).not.toBeNull()
    expect(document.querySelector("[data-readomi-video-controls]")).not.toBe(controlsHost)
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(captionHost)
    expect(translateTextCore).toHaveBeenCalledTimes(1)
  })
  it("follows YouTube's caption margin across control changes and native cue gaps while preserving custom positions", async () => {
    const player = document.createElement("div")
    player.className = "html5-video-player ytp-autohide"
    player.innerHTML = "<style>.caption-window.ytp-caption-window-bottom{margin-bottom:70px}.ytp-autohide .caption-window.ytp-caption-window-bottom{margin-bottom:0}</style><div class=\"ytp-caption-window-container\"><div class=\"caption-window ytp-caption-window-bottom\" style=\"bottom:2%\"></div></div>"
    document.body.append(player)
    player.append(video)
    vi.spyOn(player, "getBoundingClientRect").mockReturnValue({ width: 640, height: 360, top: 0, left: 0 } as DOMRect)
    const native = player.querySelector<HTMLElement>(".caption-window")!
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    const host = document.querySelector<HTMLElement>("[data-readomi-subtitles]")!
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(352.8)
    player.classList.remove("ytp-autohide")
    await vi.advanceTimersByTimeAsync(250)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(282.8)
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    expect(config.features.subtitleStyle.position).toEqual({ x: 50, y: 88 })
    expect(translateTextCore).toHaveBeenCalledTimes(1)
    native.style.marginBottom = "84px"
    await vi.advanceTimersByTimeAsync(250)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(268.8)
    native.remove()
    await vi.advanceTimersByTimeAsync(250)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(282.8)
    const probe = player.querySelector<HTMLElement>("[data-readomi-caption-position-probe]")!
    expect(probe.style.visibility).toBe("hidden")
    expect(probe.querySelector(".ytp-caption-segment")).toBeNull()
    player.classList.add("ytp-autohide")
    await vi.advanceTimersByTimeAsync(250)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(352.8)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, position: { x: 60, y: 65 } } } })
    player.classList.remove("ytp-autohide")
    await vi.advanceTimersByTimeAsync(250)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(234)
    cleanup()
    expect(player.querySelector("[data-readomi-caption-position-probe]")).toBeNull()
  })
  it("anchors automatic YouTube captions in fullscreen letterboxing and drags smoothly into the video", async () => {
    vi.spyOn(appearance, "saveSubtitleStyle").mockResolvedValue(undefined)
    const player = document.createElement("div")
    player.className = "html5-video-player ytp-autohide"
    document.body.append(player)
    player.append(video)
    vi.spyOn(player, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1920, height: 1080 } as DOMRect)
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 0, top: 135, width: 1920, height: 810 } as DOMRect)
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    const host = document.querySelector<HTMLElement>("[data-readomi-subtitles]")!
    const box = shadow.querySelector<HTMLElement>(".box")!
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
      Object.defineProperty(event, "pointerId", { value: 1 })
      box.dispatchEvent(event)
    }
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(1058.4)
    pointer("pointerdown", 960, 1030)
    pointer("pointermove", 970, 1025)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(1053.4)
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(1058.4)
    expect(Number.parseFloat(host.style.left)).toBeCloseTo(960)
    pointer("pointerdown", 960, 1030)
    pointer("pointermove", 970, 900)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(928.4)
    pointer("pointerup", 970, 900)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(928.4)
    await vi.advanceTimersByTimeAsync(0)
    update(config)
    pointer("pointerdown", 960, 1030)
    pointer("pointermove", 970, 1025)
    pointer("pointerup", 970, 1025)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(933)
  })
  it("toggles subtitles for this page, restores native captions and ignores typing", () => {
    const configured = { ...config, features: { ...config.features, subtitlesShortcut: "Alt+V" } }
    update(configured)
    const press = (target: EventTarget = document) => target.dispatchEvent(new KeyboardEvent("keydown", { key: "v", altKey: true, bubbles: true, cancelable: true }))
    const input = document.createElement("input")
    document.body.append(input)
    press(input)
    expect(track.mode).toBe("hidden")
    press()
    expect(track.mode).toBe("showing")
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(configured.features.videoSubtitles).toBe(true)
    update(configured)
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    press()
    expect(track.mode).toBe("hidden")
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBeNull()
    cleanup()
    press()
    expect(track.mode).toBe("showing")
  })
  it("sizes by the video window when YouTube's bottom anchor includes wider fullscreen bars", () => {
    const player = document.createElement("div")
    player.className = "html5-video-player ytp-autohide"
    document.body.append(player)
    player.append(video)
    vi.spyOn(player, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 320, top: 0, width: 640, height: 720 } as DOMRect)
    update(config)
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("22.4px")
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, position: { x: 50, y: 18 } } } })
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("22.4px")
  })
  it("excludes contain letterboxing from font sizing without moving the bottom anchor", async () => {
    attachXPlayer()
    video.style.objectFit = "contain"
    Object.defineProperty(video, "videoWidth", { value: 720, configurable: true })
    Object.defineProperty(video, "videoHeight", { value: 1280, configurable: true })
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)
    update(config)
    const host = document.querySelector("[data-readomi-subtitles]")
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("14.175px")
    video.style.objectFit = "fill"
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("25.2px")
    video.style.objectFit = "scale-down"
    Object.defineProperty(video, "videoWidth", { value: 180, configurable: true })
    Object.defineProperty(video, "videoHeight", { value: 320, configurable: true })
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("6.3px")
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    expect(config.features.subtitleStyle.position).toEqual(DEFAULT_CONFIG.features.subtitleStyle.position)
  })
  it("cleans VTT markup without executing HTML", () => {
    expect(readActiveCueText({ activeCues: [{ text: "<v Bob>Hello &amp; &lt;world&gt;</v>" }] } as unknown as TextTrack)).toBe("Hello & <world>")
  })
  it("only runs when enabled, caches repeated cues and restores native tracks", async () => {
    update(DEFAULT_CONFIG)
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).not.toHaveBeenCalled()
    update(config)
    expect(track.mode).toBe("hidden")
    await vi.advanceTimersByTimeAsync(1500)
    expect(translateTextCore).toHaveBeenCalledTimes(1)
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ text: "Hello", extraHashTags: ["video-subtitles"], cacheScope: "page" }))
    update(DEFAULT_CONFIG)
    expect(track.mode).toBe("showing")
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
  })
  it("keeps translated captions while using the selected service for subsequent cues", async () => {
    const nextProvider = { ...config.providersConfig[0], id: "second-service", name: "Second service", model: "second-model" }
    const stored = { ...config, providersConfig: [...config.providersConfig, nextProvider] }
    update(stored)
    await vi.advanceTimersByTimeAsync(1000)
    const host = document.querySelector("[data-readomi-subtitles]")
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")

    update({ ...stored, translate: { ...stored.translate, providerId: nextProvider.id } })
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
    await vi.advanceTimersByTimeAsync(500)
    expect(translateTextCore).toHaveBeenCalledTimes(1)

    vi.mocked(translateTextCore).mockResolvedValue("再见")
    track.activeCues = [{ text: "Goodbye" }]
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledTimes(2)
    expect(translateTextCore).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Goodbye", providerConfig: nextProvider }))
    expect(shadow.querySelector(".translated")?.textContent).toBe("再见")

    track.activeCues = [{ text: "Hello" }]
    await vi.advanceTimersByTimeAsync(500)
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
    expect(translateTextCore).toHaveBeenCalledTimes(2)
  })
  it("lets an in-flight caption finish when the selected service changes", async () => {
    let resolve!: (text: string) => void
    vi.mocked(translateTextCore).mockReturnValue(new Promise(r => resolve = r))
    const nextProvider = { ...config.providersConfig[0], id: "second-service", name: "Second service" }
    const stored = { ...config, providersConfig: [...config.providersConfig, nextProvider] }
    update(stored)
    await vi.advanceTimersByTimeAsync(750)
    const host = document.querySelector("[data-readomi-subtitles]")

    update({ ...stored, translate: { ...stored.translate, providerId: nextProvider.id } })
    resolve("Finished with the original service")
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    expect(shadow.querySelector(".translated")?.textContent).toBe("Finished with the original service")
    expect(translateTextCore).toHaveBeenCalledOnce()
  })
  it("retries a failed current caption with the newly selected service", async () => {
    vi.mocked(translateTextCore).mockRejectedValue(new Error("offline"))
    const nextProvider = { ...config.providersConfig[0], id: "second-service", name: "Second service" }
    const stored = { ...config, providersConfig: [...config.providersConfig, nextProvider] }
    update(stored)
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledOnce()
    expect(shadow.querySelector(".translated")?.textContent).toBe("subtitleTranslation.failed")

    vi.mocked(translateTextCore).mockResolvedValue("Recovered caption")
    update({ ...stored, translate: { ...stored.translate, providerId: nextProvider.id } })
    await vi.advanceTimersByTimeAsync(250)

    expect(translateTextCore).toHaveBeenCalledTimes(2)
    expect(translateTextCore).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Hello", providerConfig: nextProvider }))
    expect(shadow.querySelector(".translated")?.textContent).toBe("Recovered caption")
  })
  it("updates subtitle size, position and display mode without remounting or retranslating", async () => {
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    const host = document.querySelector("[data-readomi-subtitles]")
    expect(translateTextCore).toHaveBeenCalledTimes(1)
    update({ ...config, features: { ...config.features, subtitleMode: "translationOnly", subtitleStyle: { ...config.features.subtitleStyle, preset: "study", relativeFontSize: 25, backgroundEnabled: true, backgroundOpacity: 65, position: { x: 55, y: 60 } } } })
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("90px")
    expect(shadow.querySelector<HTMLElement>(".box")?.style.background).toBe("rgba(15, 20, 35, 0.65)")
    expect(shadow.querySelector<HTMLElement>(".original")?.hidden).toBe(true)
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
    expect((host as HTMLElement).style.left).toBe("352px")
    expect((host as HTMLElement).style.top).toBe("216px")
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, backgroundEnabled: true, backgroundOpacity: 0 } } })
    expect(shadow.querySelector<HTMLElement>(".box")?.style.background).toBe("rgba(15, 20, 35, 0)")
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, backgroundEnabled: false, backgroundOpacity: 65 } } })
    expect(shadow.querySelector<HTMLElement>(".box")?.style.background).toBe("transparent")
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledTimes(1)
  })
  it("allows increasing past 40 px and disables the size buttons at the bounds", async () => {
    attachYouTubePlayer()
    vi.spyOn(appearance, "saveSubtitleStyle").mockResolvedValue(undefined)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, relativeFontSize: 10 } } })
    const larger = controlsShadow.querySelector<HTMLButtonElement>("button[aria-label=\"subtitleStyle.larger\"]")!
    const smaller = controlsShadow.querySelector<HTMLButtonElement>("button[aria-label=\"subtitleStyle.smaller\"]")!
    expect(larger.disabled).toBe(false)
    larger.click()
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("36.63px")
    await vi.advanceTimersByTimeAsync(0)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, relativeFontSize: 25 } } })
    expect(larger.disabled).toBe(true)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, relativeFontSize: 1.25 } } })
    expect(smaller.disabled).toBe(true)
  })
  it("applies each toolbar preset with relative sizing while preserving position and cached translations", async () => {
    attachYouTubePlayer()
    const save = vi.spyOn(appearance, "saveSubtitleStyle").mockResolvedValue(undefined)
    const position = { x: 60, y: 65 }
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)
    let host: Element | null = null
    {
      update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, preset: "study", relativeFontSize: 5.9375, position } } })
      await vi.advanceTimersByTimeAsync(1000)
      host ??= document.querySelector("[data-readomi-subtitles]")
      const box = shadow.querySelector<HTMLElement>(".box")!
      expect(box.style.fontSize).toBe("42.75px")
      const presets = {
        clear: { relativeFontSize: 3.5, originalFontScale: 100, translationFont: "sans", translationColor: "#ffffff", backgroundEnabled: false, backgroundOpacity: 0 },
        gold: { relativeFontSize: 3.5, originalFontScale: 100, translationFont: "serif", translationColor: "#ffe0a0", backgroundEnabled: false, backgroundOpacity: 0 },
        ink: { relativeFontSize: 3.5, originalFontScale: 100, translationFont: "sans", translationColor: "#f9fafb", backgroundEnabled: true, backgroundOpacity: 78 },
      }
      for (const [preset, expected] of Object.entries(presets)) {
        const button = controlsShadow.querySelector<HTMLButtonElement>(`button[data-preset="${preset}"]`)!
        button.click()
        expect(button.getAttribute("aria-pressed")).toBe("true")
        expect(save).toHaveBeenLastCalledWith({ preset, ...expected })
        expect(Number.parseFloat(box.style.fontSize)).toBeCloseTo(expected.relativeFontSize * 7.2)
        expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
        expect((host as HTMLElement).style.left).toBe("768px")
        expect((host as HTMLElement).style.top).toBe("468px")
        expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
        await vi.advanceTimersByTimeAsync(0)
      }
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledTimes(1)
  })
  it("scales captions as the video window resizes without discarding cached translations", async () => {
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    const host = document.querySelector("[data-readomi-subtitles]")
    const box = shadow.querySelector<HTMLElement>(".box")!
    expect(box.style.fontSize).toBe("12.6px")
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 320, height: 180 } as DOMRect)
    await vi.advanceTimersByTimeAsync(250)
    expect(box.style.fontSize).toBe("6.3px")
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 320, height: 640 } as DOMRect)
    await vi.advanceTimersByTimeAsync(250)
    expect(box.style.fontSize).toBe("11.2px")
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)
    await vi.advanceTimersByTimeAsync(250)
    expect(box.style.fontSize).toBe("25.2px")
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, relativeFontSize: 6.25 } } })
    expect(box.style.fontSize).toBe("45px")
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 320, height: 180 } as DOMRect)
    await vi.advanceTimersByTimeAsync(250)
    expect(box.style.fontSize).toBe("11.25px")
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
    expect(translateTextCore).toHaveBeenCalledTimes(1)
    expect(config.features.subtitleStyle).toEqual(DEFAULT_CONFIG.features.subtitleStyle)
  })
  it("keeps a pending slow translation when appearance changes, but ignores it after changing the language", async () => {
    let resolve!: (text: string) => void
    vi.mocked(translateTextCore).mockReturnValue(new Promise(r => resolve = r))
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, relativeFontSize: 7.5 } } })
    vi.mocked(video.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 320, height: 180 } as DOMRect)
    resolve("Slow translation")
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector(".translated")?.textContent).toBe("Slow translation")
    expect(translateTextCore).toHaveBeenCalledTimes(1)
    const host = document.querySelector("[data-readomi-subtitles]")
    update({ ...config, language: { ...config.language, targetCode: "jpn" } })
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBe(host)
    expect(shadow.querySelector(".translated")?.textContent).not.toBe("Slow translation")
  })
  it("does not repeatedly retry failed cues and retries after the cue changes", async () => {
    vi.mocked(translateTextCore).mockRejectedValue(new Error("offline"))
    update(config)
    await vi.advanceTimersByTimeAsync(2000)
    expect(translateTextCore).toHaveBeenCalledTimes(1)
    track.activeCues = []
    await vi.advanceTimersByTimeAsync(250)
    track.activeCues = [{ text: "Hello" }]
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledTimes(2)
  })
  it("removes detached video overlays and ignores late responses after disposal", async () => {
    let resolve!: (value: string) => void
    vi.mocked(translateTextCore).mockReturnValue(new Promise(r => resolve = r))
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    video.remove()
    await vi.advanceTimersByTimeAsync(250)
    resolve("late")
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
    expect(track.mode).toBe("showing")
  })
  it("uses X's complete source instead of its showing clone and clears paused-player controls", async () => {
    vi.stubGlobal("location", new URL("https://x.com/example/status/100"))
    const article = document.createElement("article")
    article.innerHTML = "<a href='https://x.com/example/status/100'><time>today</time></a><div data-testid='videoComponent'><div data-testid='videoControls' style='opacity:1'><button>Pause</button></div></div>"
    document.body.append(article)
    article.querySelector("[data-testid='videoComponent']")!.prepend(video)
    const controls = article.querySelector<HTMLElement>("[data-testid='videoControls']")!
    vi.spyOn(controls, "getBoundingClientRect").mockReturnValue({ height: 60 } as DOMRect)
    Object.defineProperty(video, "paused", { value: true, configurable: true })
    Object.assign(track, { label: "English", language: "en", mode: "disabled", cues: [{ text: "Complete source sentence.", startTime: 0, endTime: 60 }] })
    const clone = { kind: "captions", label: "clone", language: "", mode: "showing", cues: [{ text: "Partial clone", startTime: 0, endTime: 60 }] }
    ;(video.textTracks as unknown as unknown[]).unshift(clone)
    update(config)
    await vi.advanceTimersByTimeAsync(500)
    expect(shadow.querySelector(".original")?.textContent).toBe("Complete source sentence.")
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ text: "Complete source sentence." }))
    expect(translateTextCore).not.toHaveBeenCalledWith(expect.objectContaining({ text: "Partial clone" }))
    expect(track.mode).toBe("hidden")
    expect(clone.mode).toBe("hidden")
    const host = document.querySelector<HTMLElement>("[data-readomi-subtitles]")!
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(292.8)
    controls.style.opacity = "0"
    await vi.advanceTimersByTimeAsync(250)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(352.8)
    expect(config.features.subtitleStyle.position).toEqual({ x: 50, y: 88 })
    cleanup()
    expect(track.mode).toBe("disabled")
    expect(clone.mode).toBe("showing")
  })
  it("follows nested X scrolling and resize on the next frame without polling subtitles again", async () => {
    attachXPlayer()
    const scroller = document.createElement("div")
    document.body.append(scroller)
    scroller.append(video.closest("article")!)
    let rect = new DOMRect(20, 120, 640, 360)
    vi.mocked(video.getBoundingClientRect).mockImplementation(() => rect)
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    const host = document.querySelector<HTMLElement>("[data-readomi-subtitles]")!
    const measure = vi.spyOn(shadow.querySelector<HTMLElement>(".box")!, "getBoundingClientRect")
    const request = vi.spyOn(window, "requestAnimationFrame")
    const translatedRequests = vi.mocked(translateTextCore).mock.calls.length
    const started = Date.now()
    const originalTop = Number.parseFloat(host.style.top)
    track.activeCues = [{ text: "A later cue" }]
    rect = new DOMRect(35, 70, 640, 360)
    // Element scroll events do not bubble; the renderer must capture them.
    scroller.dispatchEvent(new Event("scroll"))
    scroller.dispatchEvent(new Event("scroll"))
    window.dispatchEvent(new Event("scroll"))
    expect(request).toHaveBeenCalledTimes(1)
    expect(Number.parseFloat(host.style.top)).toBe(originalTop)
    expect(measure).not.toHaveBeenCalled()
    vi.advanceTimersToNextFrame()
    expect(Date.now() - started).toBeLessThan(250)
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(rect.top + rect.height * 0.98)
    expect(Number.parseFloat(host.style.left)).toBeCloseTo(rect.left + rect.width / 2)
    expect(measure).toHaveBeenCalledTimes(1)

    rect = new DOMRect(45, 20, 640, 360)
    scroller.dispatchEvent(new Event("scroll"))
    vi.advanceTimersToNextFrame()
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(rect.top + rect.height * 0.98)
    expect(measure).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(2)

    rect = new DOMRect(45, 20, 320, 180)
    window.dispatchEvent(new Event("resize"))
    vi.advanceTimersToNextFrame()
    expect(Number.parseFloat(host.style.top)).toBeCloseTo(rect.top + rect.height * 0.98)
    expect(Number.parseFloat(host.style.left)).toBeCloseTo(rect.left + rect.width / 2)
    expect(shadow.querySelector<HTMLElement>(".box")!.style.fontSize).toBe(`${appearance.resolveSubtitleFontSize(config.features.subtitleStyle, rect.width, rect.height)}px`)
    expect(measure).toHaveBeenCalledTimes(3)
    expect(shadow.querySelector(".original")?.textContent).toBe("Hello")
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
    expect(translateTextCore).toHaveBeenCalledTimes(translatedRequests)
    expect(config.features.subtitleStyle.position).toEqual({ x: 50, y: 88 })
  })
  it("cancels pending subtitle positioning and removes scroll and resize listeners on cleanup", () => {
    attachXPlayer()
    update(config)
    const measure = vi.spyOn(shadow.querySelector<HTMLElement>(".box")!, "getBoundingClientRect")
    const request = vi.spyOn(window, "requestAnimationFrame")
    const cancel = vi.spyOn(window, "cancelAnimationFrame")
    video.parentElement!.dispatchEvent(new Event("scroll"))
    expect(request).toHaveBeenCalledTimes(1)
    const frame = request.mock.results[0].value
    cleanup()
    expect(cancel).toHaveBeenCalledWith(frame)
    request.mockClear()
    video.parentElement!.dispatchEvent(new Event("scroll"))
    window.dispatchEvent(new Event("resize"))
    vi.advanceTimersToNextFrame()
    expect(request).not.toHaveBeenCalled()
    expect(measure).not.toHaveBeenCalled()
  })
  it("ignores a queued subtitle positioning frame after X removes its video", () => {
    attachXPlayer()
    update(config)
    const host = document.querySelector<HTMLElement>("[data-readomi-subtitles]")!
    const previousTop = host.style.top
    const measure = vi.spyOn(shadow.querySelector<HTMLElement>(".box")!, "getBoundingClientRect")
    video.parentElement!.dispatchEvent(new Event("scroll"))
    video.remove()
    vi.advanceTimersToNextFrame()
    expect(measure).not.toHaveBeenCalled()
    expect(host.style.top).toBe(previousTop)
  })
  it("releases the old X target and ignores its slow result while switching to and replacing a reply video", async () => {
    vi.stubGlobal("location", new URL("https://x.com/example/status/100"))
    const main = document.createElement("article")
    main.innerHTML = "<a href='https://x.com/example/status/100'><time>today</time></a><div data-testid='videoComponent'></div>"
    document.body.append(main)
    main.querySelector("div")!.append(video)
    track.activeCues = [{ text: "Main video" }]
    const reply = document.createElement("article")
    reply.innerHTML = "<a href='https://x.com/example/status/200'><time>today</time></a><div data-testid='videoComponent'><video></video><button>Pause reply</button></div>"
    document.body.append(reply)
    const replyVideo = reply.querySelector("video")!
    const replyTrack = { kind: "subtitles", mode: "showing", activeCues: [{ text: "Reply video" }] }
    Object.defineProperty(replyVideo, "textTracks", { value: [replyTrack] })
    vi.spyOn(replyVideo, "getBoundingClientRect").mockReturnValue({ left: 0, top: 400, width: 640, height: 360 } as DOMRect)
    let resolveMain!: (text: string) => void
    vi.mocked(translateTextCore).mockImplementation(({ text }) => text === "Main video" ? new Promise(resolve => resolveMain = resolve) : Promise.resolve(`译：${text}`))
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    const mainHost = document.querySelector("[data-readomi-subtitles]")
    reply.querySelector("button")!.focus()
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelectorAll("[data-readomi-subtitles]")).toHaveLength(1)
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBe(mainHost)
    expect(track.mode).toBe("showing")
    expect(shadow.querySelector(".translated")?.textContent).toBe("译：Reply video")
    reply.querySelector<HTMLButtonElement>("button")!.blur()
    resolveMain("Late main translation")
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector(".translated")?.textContent).toBe("译：Reply video")
    const replyHost = document.querySelector("[data-readomi-subtitles]")
    const replacement = document.createElement("video")
    const replacementTrack = { kind: "subtitles", mode: "showing", activeCues: [{ text: "Replacement video" }] }
    Object.defineProperty(replacement, "textTracks", { value: [replacementTrack] })
    vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue({ left: 0, top: 400, width: 640, height: 360 } as DOMRect)
    replyVideo.replaceWith(replacement)
    reply.querySelector("button")!.focus()
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelector("[data-readomi-subtitles]")).not.toBe(replyHost)
    expect(replyTrack.mode).toBe("showing")
    expect(shadow.querySelector(".translated")?.textContent).toBe("译：Replacement video")
  })
  it("invalidates old translations when a native track changes language without replacing its object", async () => {
    Object.assign(track, { label: "English", language: "en", cues: [{ text: "English sentence", startTime: 0, endTime: 60 }] })
    update(config)
    await vi.advanceTimersByTimeAsync(500)
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
    vi.mocked(translateTextCore).mockReturnValue(new Promise(() => {}))
    Object.assign(track, { label: "French", language: "fr", cues: [{ text: "French sentence", startTime: 0, endTime: 60 }] })
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector(".original")?.textContent).toBe("French sentence")
    expect(shadow.querySelector(".translated")?.textContent).toBe("subtitleTranslation.prefetching")
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ text: "French sentence" }))
  })
})

it("reads YouTube caption DOM even when an empty native track exists", async () => {
  const player = document.createElement("div")
  player.className = "html5-video-player"
  player.innerHTML = "<div class=\"ytp-caption-window-container\"><span class=\"ytp-caption-segment\">Reading matters.</span></div>"
  document.body.append(player)
  player.append(video)
  track.activeCues = []
  update(config)
  await vi.advanceTimersByTimeAsync(750)
  expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ text: "Reading matters." }))
  expect(player.hasAttribute("data-readomi-caption-player")).toBe(true)
  cleanup()
  expect(player.hasAttribute("data-readomi-caption-player")).toBe(false)
  expect(track.mode).toBe("showing")
})

describe("youTube timeline playback", () => {
  const setup = () => {
    const player = document.createElement("div")
    player.className = "html5-video-player"
    player.innerHTML = "<div class=\"ytp-caption-window-container\"><span class=\"ytp-caption-segment\">Partial DOM text</span></div>"
    document.body.append(player)
    player.append(video)
    track.activeCues = []
    youtube = { key: "video|en", enabled: true, cues: [
      { start: 0, end: 2, text: "First sentence." },
      { start: 2, end: 4, text: "Second sentence." },
      { start: 5, end: 7, text: "Third sentence." },
    ] }
    return player
  }
  it("shows a slow result on time for a future cue without pausing and hides subtitle gaps", async () => {
    setup()
    vi.mocked(translateTextCore).mockImplementation(({ text }) => new Promise(resolve => setTimeout(resolve, 1500, `译：${text}`)))
    update(config)
    expect(shadow.textContent).toContain("subtitleTranslation.prefetching")
    await vi.advanceTimersByTimeAsync(1750)
    expect(translateTextCore).toHaveBeenCalledTimes(3)
    expect(translateSubtitleBatch).toHaveBeenCalledWith(expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ id: "cue-0", text: "First sentence.", after: ["Second sentence.", "Third sentence."] })]) }), expect.any(AbortSignal), expect.any(Function))
    video.currentTime = 2
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector(".original")?.textContent).toBe("Second sentence.")
    expect(shadow.querySelector(".box")?.textContent).toContain("译：Second sentence.")
    video.currentTime = 4
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector(".box")?.classList.contains("empty")).toBe(true)
    expect(video.paused).toBe(false)
  })
  it("hides advertisements and clears old language translations on a track switch", async () => {
    const player = setup()
    update(config)
    await vi.advanceTimersByTimeAsync(500)
    expect(shadow.querySelector(".box")?.textContent).toContain("你好")
    player.classList.add("ad-showing")
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector(".box")?.classList.contains("empty")).toBe(true)
    player.classList.remove("ad-showing")
    vi.mocked(translateTextCore).mockReturnValue(new Promise(() => {}))
    youtube = { ...youtube, key: "video|fr" }
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector(".box")?.textContent).toContain("subtitleTranslation.prefetching")
    expect(shadow.querySelector(".box")?.textContent).not.toContain("你好")
    youtube = { key: "", cues: [], enabled: false }
    await vi.advanceTimersByTimeAsync(250)
    expect(shadow.querySelector(".box")?.classList.contains("empty")).toBe(true)
  })
  it("translates a new DOM caption while the previous request is still slow", async () => {
    const player = setup()
    youtube.cues = []
    vi.mocked(translateTextCore).mockReturnValue(new Promise(() => {}))
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    player.querySelector(".ytp-caption-segment")!.textContent = "New sentence"
    await vi.advanceTimersByTimeAsync(750)
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ text: "New sentence" }))
  })
})
