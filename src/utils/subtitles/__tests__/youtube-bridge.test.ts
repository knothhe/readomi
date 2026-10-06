// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installYouTubeSubtitleBridge, YOUTUBE_SUBTITLE_REQUEST, YOUTUBE_SUBTITLE_RESPONSE } from "../youtube-bridge"

let cleanup: () => void
let selected: { languageCode: string, vssId?: string, kind?: string } | undefined
let fetchMock: ReturnType<typeof vi.fn>
const body = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Hello world" }] }] })
async function request(requestId = "test", videoId = "video", knownKey = "") {
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: location.origin, data: { type: YOUTUBE_SUBTITLE_REQUEST, requestId, videoId, knownKey } }))
  await new Promise(resolve => setTimeout(resolve, 0))
  return vi.mocked(window.postMessage).mock.calls.map(([data]) => data).find(data => data.type === YOUTUBE_SUBTITLE_RESPONSE && data.requestId === requestId)
}

beforeEach(() => {
  selected = { languageCode: "en", vssId: ".en" }
  document.body.innerHTML = "<div class=\"html5-video-player\"></div>"
  Object.assign(document.querySelector(".html5-video-player")!, {
    getOption: () => selected,
    getPlayerResponse: () => ({ videoDetails: { videoId: "video" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: "https://www.youtube.com/api/timedtext?v=video&lang=en", languageCode: "en", vssId: ".en" },
      { baseUrl: "https://www.youtube.com/api/timedtext?v=video&lang=fr", languageCode: "fr", vssId: ".fr" },
    ] } } }),
  })
  fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => body })
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(window, "postMessage").mockImplementation(() => {})
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([])
  cleanup = installYouTubeSubtitleBridge()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("youTube page-world subtitle bridge", () => {
  it("restores native fetch and stops responding when the site runtime is disabled", async () => {
    cleanup()
    expect(window.fetch).toBe(fetchMock)
    expect(await request()).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses the signed URL observed from the player, parses the timeline and reuses its cache", async () => {
    await window.fetch("https://www.youtube.com/api/timedtext?v=video&lang=en&pot=player-proof")
    fetchMock.mockClear()
    const data = await request()
    expect(data.transcript).toBe(body)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get("pot")).toBe("player-proof")
    expect(url.searchParams.get("fmt")).toBe("json3")
    expect(await request("again", "video", data.key)).not.toHaveProperty("transcript")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("reuses the player's successful response without sending another subtitle request", async () => {
    fetchMock.mockResolvedValue({ ok: true, clone: () => ({ text: async () => body }) })
    await window.fetch("https://www.youtube.com/api/timedtext?v=video&lang=en&fmt=json3&pot=player-proof")
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await request()).toMatchObject({ enabled: true, transcript: body })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("fetches the selected language and stops when captions are turned off", async () => {
    await request()
    selected = { languageCode: "fr", vssId: ".fr" }
    const data = await request("fr")
    expect(data.key).toBe("video|.fr|")
    expect(new URL(fetchMock.mock.calls.at(-1)![0]).searchParams.get("lang")).toBe("fr")
    selected = undefined
    expect(await request("off")).toMatchObject({ enabled: false, cues: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it("falls back on empty responses, throttles retries and does not fetch unrelated videos or foreign URLs", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" })
    expect(await request()).toMatchObject({ transcript: "", enabled: true })
    await request("retry")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await request("other", "other-video")).toMatchObject({ cues: [], enabled: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    Object.assign(document.querySelector(".html5-video-player")!, {
      getPlayerResponse: () => ({ videoDetails: { videoId: "video" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "https://example.com/api/timedtext?v=video", vssId: ".en" }] } } }),
    })
    expect(await request("foreign")).toMatchObject({ cues: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("matches manual captions when the player reports an empty kind and gets the proof token from the audio track", async () => {
    selected = { languageCode: "en", kind: "" }
    Object.assign(document.querySelector(".html5-video-player")!, {
      getAudioTrack: () => ({ captionTracks: [{ vssId: ".en", url: "https://www.youtube.com/api/timedtext?v=video&lang=en&pot=audio-proof&potc=1" }] }),
    })
    expect(await request()).toMatchObject({ enabled: true, transcript: body })
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get("pot")).toBe("audio-proof")
    expect(url.searchParams.get("xorb")).toBe("2")
  })
  it("ignores messages from another frame or origin", async () => {
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: "https://example.com", data: { type: YOUTUBE_SUBTITLE_REQUEST, requestId: "foreign", videoId: "video" } }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.postMessage).not.toHaveBeenCalled()
  })

  it("passes XML to the isolated client without invoking a Trusted Types sink", async () => {
    const xml = "<transcript><text start=\"0\" dur=\"2\">Hello &amp; world</text></transcript>"
    fetchMock.mockResolvedValue({ ok: true, text: async () => xml })
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(() => {
      throw new TypeError("This document requires 'TrustedHTML' assignment.")
    })
    expect(await request()).toMatchObject({ enabled: true, transcript: xml })
    expect(parse).not.toHaveBeenCalled()
  })
})
