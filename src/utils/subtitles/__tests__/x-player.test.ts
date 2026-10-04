// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { currentXVideo, isXHost, xCaptionBottom, xStatusId, xVideoControls, xVideoIdentity, xVideoToolsStart } from "../x-player"

function post(id: string, paused = true) {
  const article = document.createElement("article")
  article.innerHTML = `<a href="https://x.com/example/status/${id}"><time>today</time></a><div data-testid="videoComponent"><div data-testid="videoPlayer"><video></video></div><div data-testid="videoControls"><button type="button">Pause</button></div></div>`
  document.body.append(article)
  const video = article.querySelector("video")!
  Object.defineProperty(video, "paused", { value: paused, configurable: true })
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({ width: 640, height: 360 } as DOMRect)
  return { article, video, controls: article.querySelector<HTMLElement>("[data-testid='videoControls']")! }
}

function adPlayer() {
  const container = document.createElement("div")
  container.dataset.testid = "videoComponent"
  const button = (label: string, attributes = "") => `<button role="button" aria-label="${label}" ${attributes}><div><svg></svg></div></button>`
  container.innerHTML = `<video></video>
    <div class="ad-top" style="display:flex;flex-direction:row"><a>Visit advertiser</a><div>${button("More", "aria-haspopup='menu'")}</div></div>
    <div class="bottom" style="display:flex;flex-direction:column"><div role="slider" aria-label="Seek"></div>
      <div class="row" style="display:flex;flex-direction:row"><div>${button("Pause")}<span>0:04 / 0:15</span></div><div class="right">${button("Mute")}<div>${button("Fullscreen")}</div></div></div>
    </div>`
  document.body.append(container)
  const video = container.querySelector("video")!
  const top = container.querySelector<HTMLElement>(".ad-top")!
  const bottom = container.querySelector<HTMLElement>(".bottom")!
  const row = container.querySelector<HTMLElement>(".row")!
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 640, 360))
  vi.spyOn(top, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 640, 56))
  vi.spyOn(bottom, "getBoundingClientRect").mockReturnValue(new DOMRect(24, 328, 632, 62))
  const rowBounds = vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(24, 348, 632, 40))
  return { container, video, top, bottom, row, rowBounds }
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
  it("finds the bottom playback row instead of an earlier advertising menu without a videoControls marker", () => {
    const { container, video, row, top } = adPlayer()
    expect(xVideoControls(video)).toBe(row)
    expect(xVideoToolsStart(row)).toBe(row.querySelector(".right"))
    // A CTA can itself be a button, so button count alone is not enough.
    top.querySelector("a")!.outerHTML = "<button role='button'><div><svg></svg></div></button>"
    expect(xVideoControls(video)).toBe(row)
    // The extension's own slots must not supply playback evidence.
    container.querySelector(".bottom")!.remove()
    top.insertAdjacentHTML("beforeend", "<span data-readomi-controls-anchor></span>")
    expect(xVideoControls(video)).toBeNull()
  })

  it("rejects advertising-only and floating-mute overlays without reserving their height for subtitles", () => {
    const { container, video, bottom } = adPlayer()
    bottom.remove()
    expect(xVideoControls(video)).toBeNull()
    expect(xCaptionBottom(video, { height: 360 }, true)).toBeCloseTo(352.8)
    container.querySelector(".ad-top")!.remove()
    container.insertAdjacentHTML("beforeend", "<div class='floating' style='display:flex;flex-direction:row'><button role='button'><div><svg></svg></div></button></div>")
    vi.spyOn(container.querySelector<HTMLElement>(".floating")!, "getBoundingClientRect").mockReturnValue(new DOMRect(24, 348, 632, 40))
    expect(xVideoControls(video)).toBeNull()
    expect(xCaptionBottom(video, { height: 360 })).toBeCloseTo(352.8)
  })

  it("keeps the playback association through opacity hiding and follows a replaced row", () => {
    const { video, top, bottom, row } = adPlayer()
    top.style.opacity = "0"
    expect(xCaptionBottom(video, { height: 360 })).toBeCloseTo(312.8)
    bottom.style.opacity = "0"
    expect(xVideoControls(video)).toBe(row)
    expect(xCaptionBottom(video, { height: 360 })).toBeCloseTo(352.8)
    const replacement = row.cloneNode(true) as HTMLElement
    vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue(new DOMRect(24, 348, 632, 40))
    row.replaceWith(replacement)
    bottom.style.opacity = "1"
    expect(xVideoControls(video)).toBe(replacement)
    expect(xCaptionBottom(video, { height: 360 })).toBeCloseTo(312.8)
  })

  it("requires a full-width horizontal row at the video bottom", () => {
    const { video, row, rowBounds } = adPlayer()
    rowBounds.mockReturnValue(new DOMRect(24, 34, 632, 40))
    expect(xVideoControls(video)).toBeNull()
    rowBounds.mockReturnValue(new DOMRect(500, 348, 156, 40))
    expect(xVideoControls(video)).toBeNull()
    rowBounds.mockReturnValue(new DOMRect(24, 348, 632, 40))
    row.style.flexDirection = "column"
    expect(xVideoControls(video)).toBeNull()
    row.style.flexDirection = "row"
    expect(xVideoControls(video)).toBe(row)
  })

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
