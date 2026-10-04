// @vitest-environment jsdom
import { act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { createInlineHoverStreamPreview } from "../inline-hover-stream-preview"

type Preview = NonNullable<ReturnType<typeof createInlineHoverStreamPreview>>

let frames: Map<number, FrameRequestCallback>
let previews: Preview[]
let nextFrame: number

function createPreview() {
  const anchor = document.createElement("p")
  anchor.textContent = "The original paragraph stays readable while translation is pending."
  anchor.style.cssText = "display:block;font-size:16px;line-height:24px;box-sizing:border-box"
  document.body.append(anchor)
  const preview = createInlineHoverStreamPreview(anchor, DEFAULT_CONFIG, vi.fn())!
  previews.push(preview)
  return { anchor, preview }
}

function advanceFrame() {
  act(() => {
    const queued = [...frames.values()]
    frames.clear()
    for (const callback of queued)
      callback(16)
  })
}

beforeEach(() => {
  document.body.innerHTML = ""
  frames = new Map()
  previews = []
  nextFrame = 0
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id)
  })
})

afterEach(() => {
  act(() => {
    for (const preview of previews)
      preview.dispose()
  })
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("inline hover preview visibility", () => {
  it("keeps preserved output unmounted and applies target direction independently per group", async () => {
    const { anchor, preview } = createPreview()
    const kept = preview.register(anchor)
    act(() => kept(""))
    advanceFrame()
    expect(anchor.querySelector("[data-readomi-inline-preview]")).toBeNull()

    const arabic = preview.register(anchor)
    const english = preview.register(anchor)
    act(() => {
      arabic.setTargetLanguage("arb")
      english.setTargetLanguage("eng")
      arabic("مرحبا")
      english("Hello")
    })
    advanceFrame()
    const content = anchor.querySelector("[data-readomi-inline-preview]")!.shadowRoot!
    const groups = content.querySelectorAll<HTMLElement>(".preview-translation")
    expect(groups[1].dir).toBe("rtl")
    expect(groups[1].lang).toBe("ar")
    expect(groups[2].dir).toBe("ltr")
    expect(groups[2].lang).toBe("en")
    const finished = preview.finish(["", "مرحبا", "Hello"])
    advanceFrame()
    expect(await finished).toBe(true)
  })

  it.each([
    ["empty output", ""],
    ["whitespace", " \n\t "],
    ["HTML without text", "<span></span><br>"],
    ["HTML containing whitespace", "<span> \n </span>"],
    ["an incomplete named entity", "&amp"],
    ["an incomplete numeric entity", "&#x4"],
  ])("keeps waiting for visible text after %s", (_description, partial) => {
    const { anchor, preview } = createPreview()
    const onTextVisible = vi.fn()
    const update = preview.register(anchor, onTextVisible)

    act(() => update(partial))
    advanceFrame()

    expect(onTextVisible).not.toHaveBeenCalled()
    const host = anchor.querySelector("[data-readomi-inline-preview]")
    expect(host?.shadowRoot?.querySelector(".group")?.textContent ?? "").toBe("")
  })

  it("reports first visibility after the text is written and only once as it grows", async () => {
    const { anchor, preview } = createPreview()
    const onTextVisible = vi.fn(() => {
      const host = anchor.querySelector("[data-readomi-inline-preview]")!
      expect(host.shadowRoot!.querySelector(".group")!.textContent).toBe("首段译文")
    })
    const update = preview.register(anchor, onTextVisible)

    act(() => update("<span>&nbsp;首段译文</span>"))
    expect(onTextVisible).not.toHaveBeenCalled()
    advanceFrame()
    expect(onTextVisible).toHaveBeenCalledTimes(1)

    act(() => update("首段译文，随后补全。"))
    advanceFrame()
    const finished = preview.finish(["首段译文，随后补全。"])
    advanceFrame()
    expect(await finished).toBe(true)
    expect(onTextVisible).toHaveBeenCalledTimes(1)
  })

  it("keeps each group's waiting state until that group's text appears", () => {
    const { anchor, preview } = createPreview()
    const firstVisible = vi.fn()
    const secondVisible = vi.fn()
    const updateFirst = preview.register(anchor, firstVisible)
    const updateSecond = preview.register(anchor, secondVisible)

    act(() => {
      updateFirst("&amp")
      updateSecond("第二组译文")
    })
    advanceFrame()
    expect(firstVisible).not.toHaveBeenCalled()
    expect(secondVisible).toHaveBeenCalledTimes(1)

    act(() => updateFirst("第一组译文"))
    advanceFrame()
    expect(firstVisible).toHaveBeenCalledTimes(1)
    expect(secondVisible).toHaveBeenCalledTimes(1)
  })

  it("does not report visibility when canceled before the queued reveal", () => {
    const { anchor, preview } = createPreview()
    const onTextVisible = vi.fn()
    const update = preview.register(anchor, onTextVisible)
    act(() => update("即将显示的译文"))
    const dispatchedFrames = [...frames.values()]

    act(() => preview.dispose())
    act(() => {
      for (const callback of dispatchedFrames)
        callback(16)
    })

    expect(onTextVisible).not.toHaveBeenCalled()
    expect(anchor.querySelector("[data-readomi-inline-preview]")).toBeNull()
  })

  it("allows a final result without partials to commit without claiming a preview was visible", async () => {
    const { anchor, preview } = createPreview()
    const onTextVisible = vi.fn()
    preview.register(anchor, onTextVisible)

    expect(await preview.finish(["完整译文"])).toBe(true)
    advanceFrame()
    expect(onTextVisible).not.toHaveBeenCalled()
    expect(anchor.querySelector("[data-readomi-inline-preview]")).toBeNull()
  })
})
