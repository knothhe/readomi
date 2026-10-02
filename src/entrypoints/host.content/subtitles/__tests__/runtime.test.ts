// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { bootstrapVideoSubtitles, readActiveCueText } from "../runtime"

let update: (config: Config | null) => void
vi.mock("@/utils/config/storage", () => ({ subscribeLocalConfig: (callback: typeof update) => {
  update = callback
  return vi.fn()
} }))
vi.mock("@/utils/host/translate/translate-text", () => ({ translateTextCore: vi.fn() }))
let youtube = { key: "", cues: [] as { start: number, end: number, text: string }[], enabled: null as boolean | null }
vi.mock("@/utils/subtitles/youtube-client", () => ({ createYouTubeTimeline: () => ({ tick: () => youtube, dispose: vi.fn() }) }))
let shadow: ShadowRoot
let cleanup: () => void
let track: { kind: string, mode: string, activeCues: { text: string }[] }
let video: HTMLVideoElement
const config: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoSubtitles: true }, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "local" })) }
beforeEach(() => {
  vi.useFakeTimers()
  youtube = { key: "", cues: [], enabled: null }
  const attach = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, options) {
    shadow = attach.call(this, options)
    return shadow
  })
  document.body.innerHTML = "<video></video>"
  video = document.querySelector("video")!
  track = { kind: "subtitles", mode: "showing", activeCues: [{ text: "Hello" }] }
  Object.defineProperty(video, "textTracks", { value: [track] })
  Object.defineProperty(video, "paused", { value: false })
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 640, height: 360 } as DOMRect)
  vi.mocked(translateTextCore).mockResolvedValue("你好")
  cleanup = bootstrapVideoSubtitles()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("local subtitle runtime", () => {
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
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ text: "Hello", extraHashTags: ["video-subtitles"] }))
    update(DEFAULT_CONFIG)
    expect(track.mode).toBe("showing")
    expect(document.querySelector("[data-readomi-subtitles]")).toBeNull()
  })
  it("updates subtitle size, position and display mode without remounting or retranslating", async () => {
    update(config)
    await vi.advanceTimersByTimeAsync(1000)
    const host = document.querySelector("[data-readomi-subtitles]")
    expect(translateTextCore).toHaveBeenCalledTimes(1)
    update({ ...config, features: { ...config.features, subtitleMode: "translationOnly", subtitleStyle: { preset: "study", fontSize: 80, position: { x: 55, y: 60 } } } })
    expect(document.querySelector("[data-readomi-subtitles]")).toBe(host)
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("80px")
    expect(shadow.querySelector<HTMLElement>(".original")?.hidden).toBe(true)
    expect(shadow.querySelector(".translated")?.textContent).toBe("你好")
    expect((host as HTMLElement).style.left).toBe("352px")
    expect((host as HTMLElement).style.top).toBe("216px")
    await vi.advanceTimersByTimeAsync(1000)
    expect(translateTextCore).toHaveBeenCalledTimes(1)
  })
  it("allows increasing past 40 px and disables the size buttons at the bounds", () => {
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, fontSize: 40 } } })
    const larger = shadow.querySelector<HTMLButtonElement>("button[aria-label=\"subtitleStyle.larger\"]")!
    const smaller = shadow.querySelector<HTMLButtonElement>("button[aria-label=\"subtitleStyle.smaller\"]")!
    expect(larger.disabled).toBe(false)
    larger.click()
    expect(shadow.querySelector<HTMLElement>(".box")?.style.fontSize).toBe("41px")
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, fontSize: 80 } } })
    expect(larger.disabled).toBe(true)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, fontSize: 14 } } })
    expect(smaller.disabled).toBe(true)
  })
  it("keeps a pending slow translation when appearance changes, but ignores it after changing the language", async () => {
    let resolve!: (text: string) => void
    vi.mocked(translateTextCore).mockReturnValue(new Promise(r => resolve = r))
    update(config)
    await vi.advanceTimersByTimeAsync(750)
    update({ ...config, features: { ...config.features, subtitleStyle: { ...config.features.subtitleStyle, fontSize: 30 } } })
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
