// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { currentXVideo, isXHost, xCaptionBottom, xStatusId, xVideoIdentity } from "../x-player"

function post(id: string, paused = true) {
  const article = document.createElement("article")
  article.innerHTML = `<a href="https://x.com/example/status/${id}"><time>today</time></a><div data-testid="videoComponent"><div data-testid="videoPlayer"><video></video></div><div data-testid="videoControls"><button type="button">Pause</button></div></div>`
  document.body.append(article)
  const video = article.querySelector("video")!
  Object.defineProperty(video, "paused", { value: paused, configurable: true })
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({ width: 640, height: 360 } as DOMRect)
  return { article, video, controls: article.querySelector<HTMLElement>("[data-testid='videoControls']")! }
}

beforeEach(() => {
  vi.stubGlobal("location", new URL("https://x.com/example/status/100"))
  document.body.innerHTML = ""
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("x subtitle player", () => {
  it("accepts X and Twitter status identities without matching unrelated hosts", () => {
    expect(xStatusId("https://mobile.twitter.com/user/status/123/video/1")).toBe("123")
    expect(xStatusId("https://x.com/i/status/456?s=20")).toBe("456")
    expect(xStatusId("https://notx.com/user/status/123")).toBeNull()
    expect(xStatusId("https://x.com/user/status/not-numeric")).toBeNull()
    expect(isXHost("x.com.example.org")).toBe(false)
  })

  it("prefers the current post, then the reply the reader focuses, with fullscreen taking precedence", () => {
    const main = post("100")
    const reply = post("200", false)
    expect(currentXVideo()).toBe(main.video)
    reply.controls.querySelector("button")!.focus()
    expect(currentXVideo()).toBe(reply.video)
    reply.video.dataset.readomiXSubtitlePage = location.pathname
    reply.controls.querySelector<HTMLButtonElement>("button")!.blur()
    expect(currentXVideo()).toBe(reply.video)
    vi.stubGlobal("location", new URL("https://x.com/example/status/100/video/1"))
    expect(currentXVideo()).toBe(main.video)
    Object.defineProperty(document, "fullscreenElement", { value: main.article, configurable: true })
    expect(currentXVideo()).toBe(main.video)
    Reflect.deleteProperty(document, "fullscreenElement")
    expect(xVideoIdentity(reply.video)).toBe("200")
  })

  it("chooses the playing timeline video and ignores hidden or detached posts", () => {
    vi.stubGlobal("location", new URL("https://x.com/home"))
    const first = post("100")
    const second = post("200", false)
    first.video.dataset.readomiXSubtitlePage = location.pathname
    expect(currentXVideo()).toBe(second.video)
    second.article.setAttribute("aria-hidden", "true")
    expect(currentXVideo()).toBe(first.video)
    first.article.remove()
    expect(currentXVideo()).toBeNull()
  })

  it("clears visible controls using measured height, respects explicit hiding and caps narrow videos", () => {
    const { video, controls } = post("100")
    vi.spyOn(controls, "getBoundingClientRect").mockReturnValue({ height: 60 } as DOMRect)
    expect(xCaptionBottom(video, { height: 360 })).toBeCloseTo(292.8)
    controls.style.opacity = "0"
    expect(xCaptionBottom(video, { height: 360 })).toBeCloseTo(352.8)
    controls.style.opacity = "1"
    expect(xCaptionBottom(video, { height: 180 })).toBeCloseTo(131.4)
    Object.defineProperty(video, "paused", { value: false })
    expect(xCaptionBottom(video, { height: 360 })).toBeCloseTo(352.8)
    expect(xCaptionBottom(video, { height: 360 }, true)).toBeCloseTo(292.8)
    controls.querySelector("button")!.focus()
    expect(xCaptionBottom(video, { height: 360 })).toBeCloseTo(292.8)
  })
})
