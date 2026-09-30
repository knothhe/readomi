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
let cleanup: () => void
let track: { kind: string, mode: string, activeCues: { text: string }[] }
let video: HTMLVideoElement
const config: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoSubtitles: true }, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "local" })) }
beforeEach(() => {
  vi.useFakeTimers()
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
    expect(document.querySelector("[data-reading-subtitles]")).toBeNull()
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
    expect(document.querySelector("[data-reading-subtitles]")).toBeNull()
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
  expect(player.hasAttribute("data-reading-caption-player")).toBe(true)
  cleanup()
  expect(player.hasAttribute("data-reading-caption-player")).toBe(false)
  expect(track.mode).toBe("showing")
})
