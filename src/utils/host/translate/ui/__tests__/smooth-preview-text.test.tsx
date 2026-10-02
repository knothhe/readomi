// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SmoothPreviewText } from "../smooth-preview-text"

interface TestFrameData {
  delta: number
  timestamp: number
  isProcessing: boolean
}

type FrameCallback = (data: TestFrameData) => void

const scheduler = vi.hoisted(() => {
  const callbacks = new Map<FrameCallback, boolean>()
  return {
    callbacks,
    render: vi.fn((callback: FrameCallback, keepAlive = false) => {
      callbacks.set(callback, keepAlive)
    }),
    cancel: vi.fn((callback: FrameCallback) => {
      callbacks.delete(callback)
    }),
  }
})

vi.mock("motion", () => ({
  frame: { render: scheduler.render },
  cancelFrame: scheduler.cancel,
}))

let timestamp = 0
let reducedMotion = false
let preferenceListeners: Set<(event: MediaQueryListEvent) => void>
let removePreferenceListener: ReturnType<typeof vi.fn>

function advanceFrames(count: number, inspect?: () => void) {
  for (let index = 0; index < count; index++) {
    act(() => {
      timestamp += 16
      for (const [callback, keepAlive] of [...scheduler.callbacks]) {
        if (!scheduler.callbacks.has(callback))
          continue
        if (!keepAlive)
          scheduler.callbacks.delete(callback)
        callback({ delta: 16, timestamp, isProcessing: true })
      }
    })
    inspect?.()
  }
}

function setReducedMotion(value: boolean) {
  act(() => {
    reducedMotion = value
    const event = { matches: value } as MediaQueryListEvent
    for (const listener of [...preferenceListeners])
      listener(event)
  })
}

beforeEach(() => {
  timestamp = 0
  reducedMotion = false
  scheduler.callbacks.clear()
  scheduler.render.mockClear()
  scheduler.cancel.mockClear()
  preferenceListeners = new Set()
  removePreferenceListener = vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
    preferenceListeners.delete(listener)
  })
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return reducedMotion },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      preferenceListeners.add(listener)
    },
    removeEventListener: removePreferenceListener,
  })))
})

afterEach(() => {
  cleanup()
  scheduler.callbacks.clear()
  vi.unstubAllGlobals()
})

describe("smooth preview text", () => {
  it("continues from the visible prefix when a provider appends another chunk", () => {
    const firstChunk = "Streaming translation should remain readable while more words arrive. ".repeat(2)
    const fullText = `${firstChunk}The next chunk continues the same paragraph.`
    const onProgress = vi.fn()
    const onComplete = vi.fn()
    const { container, rerender } = render(<SmoothPreviewText content={firstChunk} done={false} onProgress={onProgress} onComplete={onComplete} />)

    advanceFrames(10)
    const visiblePrefix = container.textContent!
    expect(visiblePrefix.length).toBeGreaterThan(0)
    expect(visiblePrefix.length).toBeLessThan(firstChunk.length)

    rerender(<SmoothPreviewText content={fullText} done={false} onProgress={onProgress} onComplete={onComplete} />)
    expect(container.textContent).toBe(visiblePrefix)
    let previousLength = visiblePrefix.length
    advanceFrames(500, () => {
      const text = container.textContent!
      expect(text.startsWith(visiblePrefix)).toBe(true)
      expect(fullText.startsWith(text)).toBe(true)
      expect(text.length).toBeGreaterThanOrEqual(previousLength)
      previousLength = text.length
    })
    expect(container.textContent).toBe(fullText)
    expect(onProgress).toHaveBeenLastCalledWith(fullText.length)
    expect(onComplete).not.toHaveBeenCalled()

    rerender(<SmoothPreviewText content={fullText} done onProgress={onProgress} onComplete={onComplete} />)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("finishes revealing the remaining text before reporting a completed stream", () => {
    const content = "A completed network response can still have a long unread preview waiting to appear. ".repeat(2)
    const onComplete = vi.fn()
    const { container, rerender } = render(<SmoothPreviewText content={content} done={false} onComplete={onComplete} />)
    advanceFrames(8)
    const visiblePrefix = container.textContent

    rerender(<SmoothPreviewText content={content} done onComplete={onComplete} />)
    expect(container.textContent).toBe(visiblePrefix)
    expect(container.textContent!.length).toBeLessThan(content.length)
    expect(onComplete).not.toHaveBeenCalled()

    advanceFrames(500)
    expect(container.textContent).toBe(content)
    expect(onComplete).toHaveBeenCalledTimes(1)
    advanceFrames(20)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("only reveals complete emoji and combining-character graphemes", () => {
    const graphemes = ["译", "👨‍👩‍👧‍👦", "e\u0301", "🇨🇳", "👍🏽", "！"]
    const content = graphemes.join("")
    const prefixes = new Set(["", ...graphemes.map((_, index) => graphemes.slice(0, index + 1).join(""))])
    const onProgress = vi.fn()
    const { container } = render(<SmoothPreviewText content={content} done onProgress={onProgress} />)
    const visibleTexts = new Set<string>()

    advanceFrames(100, () => {
      const text = container.textContent!
      expect(prefixes.has(text)).toBe(true)
      visibleTexts.add(text)
    })
    expect(container.textContent).toBe(content)
    expect([...visibleTexts].some(text => text.length > 0 && text.length < content.length)).toBe(true)
    const validLengths = new Set([...prefixes].map(text => text.length))
    for (const [length] of onProgress.mock.calls)
      expect(validLengths.has(length)).toBe(true)
  })

  it("clears an obsolete prefix when the content is replaced rather than appended", () => {
    const first = "An obsolete translation should stop appearing when a new answer replaces it."
    const replacement = "新的译文从头显示，不应混入之前的内容。"
    const onComplete = vi.fn()
    const { container, rerender } = render(<SmoothPreviewText content={first} done={false} onComplete={onComplete} />)
    advanceFrames(10)
    expect(container.textContent!.length).toBeGreaterThan(0)

    rerender(<SmoothPreviewText content={replacement} done onComplete={onComplete} />)
    expect(replacement.startsWith(container.textContent!)).toBe(true)
    expect(container.textContent).not.toContain("An")
    expect(onComplete).not.toHaveBeenCalled()
    advanceFrames(200)
    expect(container.textContent).toBe(replacement)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("cancels queued frames on unmount and ignores an already dispatched callback", () => {
    const content = "A canceled preview must not keep writing into a detached translation node. ".repeat(2)
    const onProgress = vi.fn()
    const onComplete = vi.fn()
    const { container, unmount } = render(<SmoothPreviewText content={content} done onProgress={onProgress} onComplete={onComplete} />)
    advanceFrames(8)
    const node = container.firstElementChild!
    const visiblePrefix = node.textContent
    const dispatchedCallbacks = [...scheduler.callbacks.keys()]
    expect(dispatchedCallbacks.length).toBeGreaterThan(0)
    onProgress.mockClear()
    onComplete.mockClear()

    unmount()
    expect(scheduler.cancel).toHaveBeenCalled()
    expect(scheduler.callbacks.size).toBe(0)
    act(() => {
      for (const callback of dispatchedCallbacks)
        callback({ delta: 16, timestamp: timestamp + 16, isProcessing: true })
    })
    expect(node.textContent).toBe(visiblePrefix)
    expect(onProgress).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("shows each chunk immediately when reduced motion is enabled and waits for done", () => {
    reducedMotion = true
    const onComplete = vi.fn()
    const { container, rerender, unmount } = render(<SmoothPreviewText content="首段译文" done={false} onComplete={onComplete} />)
    expect(container.textContent).toBe("首段译文")
    expect(scheduler.callbacks.size).toBe(0)
    expect(onComplete).not.toHaveBeenCalled()

    rerender(<SmoothPreviewText content="首段译文，随后补全。" done={false} onComplete={onComplete} />)
    expect(container.textContent).toBe("首段译文，随后补全。")
    rerender(<SmoothPreviewText content="首段译文，随后补全。" done onComplete={onComplete} />)
    expect(onComplete).toHaveBeenCalledTimes(1)
    unmount()
    expect(removePreferenceListener).toHaveBeenCalled()
    expect(preferenceListeners.size).toBe(0)
  })

  it("responds to reduced-motion changes during playback and cleans up the listener", () => {
    const content = "A reader can change their motion preference while the translation is appearing."
    const moreContent = `${content} A later chunk still respects the current preference.`
    const onComplete = vi.fn()
    const { container, rerender, unmount } = render(<SmoothPreviewText content={content} done={false} onComplete={onComplete} />)
    advanceFrames(8)
    expect(container.textContent!.length).toBeLessThan(content.length)

    setReducedMotion(true)
    expect(container.textContent).toBe(content)
    expect(scheduler.callbacks.size).toBe(0)
    expect(onComplete).not.toHaveBeenCalled()

    setReducedMotion(false)
    rerender(<SmoothPreviewText content={moreContent} done={false} onComplete={onComplete} />)
    expect(container.textContent).toBe(content)
    advanceFrames(8)
    expect(container.textContent!.startsWith(content)).toBe(true)
    expect(container.textContent!.length).toBeLessThan(moreContent.length)
    setReducedMotion(true)
    expect(container.textContent).toBe(moreContent)
    rerender(<SmoothPreviewText content={moreContent} done onComplete={onComplete} />)
    expect(onComplete).toHaveBeenCalledTimes(1)
    unmount()
    expect(preferenceListeners.size).toBe(0)
    expect(removePreferenceListener).toHaveBeenCalled()
  })
})
