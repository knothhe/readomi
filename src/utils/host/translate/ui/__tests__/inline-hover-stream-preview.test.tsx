// @vitest-environment jsdom
import { act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { createInlineHoverStreamPreview } from "../inline-hover-stream-preview"
import { setPendingTranslationLayout } from "../translation-layout"

type Preview = NonNullable<ReturnType<typeof createInlineHoverStreamPreview>>

let frames: Map<number, FrameRequestCallback>
let previews: Preview[]
let nextFrame: number

function createPreview() {
  const anchor = document.createElement("p")
  anchor.textContent = "The original paragraph stays readable while translation is pending."
  anchor.style.cssText = "display:block;font-size:16px;line-height:24px;box-sizing:border-box"
  document.body.append(anchor)
  setPendingTranslationLayout(anchor, "block")
  const preview = createInlineHoverStreamPreview(anchor, DEFAULT_CONFIG, vi.fn())!
  previews.push(preview)
  return { anchor, preview }
}

function registerBlock(preview: Preview, anchor: HTMLElement, onTextVisible?: () => void) {
  const update = preview.register(anchor, onTextVisible)
  if (!update)
    throw new Error("A resolved block translation must register a streaming preview")
  return update
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
    const kept = registerBlock(preview, anchor)
    act(() => kept(""))
    advanceFrame()
    expect(anchor.querySelector("[data-readomi-inline-preview]")).toBeNull()

    const arabic = registerBlock(preview, anchor)
    const english = registerBlock(preview, anchor)
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
    const update = registerBlock(preview, anchor, onTextVisible)

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
    const update = registerBlock(preview, anchor, onTextVisible)

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
    const updateFirst = registerBlock(preview, anchor, firstVisible)
    const updateSecond = registerBlock(preview, anchor, secondVisible)

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
    const update = registerBlock(preview, anchor, onTextVisible)
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
    registerBlock(preview, anchor, onTextVisible)

    expect(await preview.finish(["完整译文"])).toBe(true)
    advanceFrame()
    expect(onTextVisible).not.toHaveBeenCalled()
    expect(anchor.querySelector("[data-readomi-inline-preview]")).toBeNull()
  })

  it("defers an inline translation until the final result without reserving a block preview", async () => {
    const { anchor, preview } = createPreview()
    setPendingTranslationLayout(anchor, "inline")
    const onTextVisible = vi.fn()

    expect(preview.register(anchor, onTextVisible)).toBeUndefined()
    expect(await preview.finish(["行内译文"])).toBe(true)
    advanceFrame()

    expect(anchor.textContent).toBe("The original paragraph stays readable while translation is pending.")
    expect(anchor.querySelector("[data-readomi-inline-preview]")).toBeNull()
    expect(onTextVisible).not.toHaveBeenCalled()
  })
})
