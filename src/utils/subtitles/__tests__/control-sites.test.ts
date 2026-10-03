// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { shouldShowVideoControls } from "../control-sites"

let video: HTMLVideoElement

beforeEach(() => {
  document.body.innerHTML = "<main id='movie_player' class='html5-video-player'><video></video></main>"
  video = document.querySelector("video")!
})

afterEach(() => document.body.replaceChildren())

describe("subtitle toolbar supported sites", () => {
  it.each([
    "https://youtube.com/watch?v=one",
    "https://www.youtube.com/watch?v=one&t=30",
    "https://m.youtube.com/live/one",
    "https://www.youtube.com/embed/one",
    "https://www.youtube-nocookie.com/embed/one",
    "https://www.youtube.com/shorts/one",
  ])("shows the toolbar in a supported YouTube player at %s", (url) => {
    expect(shouldShowVideoControls(video, url)).toBe(true)
  })

  it.each([
    "https://www.bilibili.com/video/BVexample",
    "https://search.bilibili.com/all?keyword=example",
    "https://www.youtube.com/",
    "https://www.youtube.com/results?search_query=example",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch/preview?v=one",
    "https://youtube.com.example.com/watch?v=one",
    "https://notyoutube.com/watch?v=one",
    "https://twitter.com.example.com/status/one",
    "file:///watch?v=one",
    "not a URL",
  ])("does not expose the toolbar outside supported sites and playback routes: %s", (url) => {
    expect(shouldShowVideoControls(video, url)).toBe(false)
  })

  it("requires the main watch player and ignores related video previews", () => {
    const preview = document.createElement("div")
    preview.className = "html5-video-player"
    document.body.append(preview)
    preview.append(video)
    expect(shouldShowVideoControls(video, "https://www.youtube.com/watch?v=one")).toBe(false)
    document.querySelector("#movie_player")!.remove()
    expect(shouldShowVideoControls(video, "https://www.youtube.com/watch?v=one")).toBe(false)
    expect(shouldShowVideoControls(video, "https://www.youtube-nocookie.com/embed/one")).toBe(true)
  })

  it("uses the active Shorts player when its overlay is present", () => {
    const overlay = document.createElement("div")
    overlay.id = "reel-overlay-container"
    const active = document.createElement("div")
    active.className = "html5-video-player"
    overlay.append(active)
    document.body.append(overlay)
    expect(shouldShowVideoControls(video, "https://www.youtube.com/shorts/one")).toBe(false)
    active.append(video)
    expect(shouldShowVideoControls(video, "https://www.youtube.com/shorts/one")).toBe(true)
  })

  it.each(["https://x.com/home", "https://www.x.com/example/status/100", "https://twitter.com/example/status/100"])("supports article videos on X and Twitter at %s", (url) => {
    expect(shouldShowVideoControls(video, url)).toBe(false)
    const article = document.createElement("article")
    document.body.append(article)
    article.append(video)
    expect(shouldShowVideoControls(video, url)).toBe(true)
  })
})
