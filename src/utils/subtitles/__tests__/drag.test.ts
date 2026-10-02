// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { bindSubtitleDrag } from "../drag"

const rect = { width: 640, height: 360, left: 0, top: 0 } as DOMRect
let cleanup: (() => void) | undefined
function pointer(element: HTMLElement, type: string, x: number, y: number, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button })
  Object.defineProperty(event, "pointerId", { value: 1 })
  element.dispatchEvent(event)
}
function setup() {
  document.body.innerHTML = "<div tabindex=\"0\"><button>+</button></div>"
  const element = document.querySelector("div")!
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ width: 200, height: 60 } as DOMRect)
  let position = { x: 50, y: 88 }
  const commit = vi.fn()
  const move = vi.fn((next) => {
    position = next
  })
  cleanup = bindSubtitleDrag(element, { videoRect: () => rect, position: () => position, move, commit })
  return { element, commit, move, position: () => position }
}
afterEach(() => {
  cleanup?.()
  vi.restoreAllMocks()
})

describe("subtitle drag interaction", () => {
  it("moves relative to the video and saves once at the end of a drag", () => {
    const { element, move, commit, position } = setup()
    pointer(element, "pointerdown", 320, 300)
    pointer(element, "pointermove", 322, 300)
    expect(move).not.toHaveBeenCalled()
    pointer(element, "pointermove", 384, 228)
    expect(position()).toEqual({ x: 60, y: 68 })
    expect(commit).not.toHaveBeenCalled()
    pointer(element, "pointerup", 384, 228)
    expect(commit).toHaveBeenCalledExactlyOnceWith({ x: 60, y: 68 })
    expect(element.classList.contains("dragging")).toBe(false)
  })
  it("keeps the whole subtitle box within the video and cancels a drag with Escape", () => {
    const { element, commit, position } = setup()
    pointer(element, "pointerdown", 320, 300)
    pointer(element, "pointermove", -1000, -1000)
    expect(position().x / 100 * rect.width - 100).toBeGreaterThanOrEqual(12)
    expect(position().y / 100 * rect.height - 60).toBeGreaterThanOrEqual(12)
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(position()).toEqual({ x: 50, y: 88 })
    expect(commit).not.toHaveBeenCalled()
  })
  it("supports keyboard movement and leaves toolbar controls out of the drag gesture", () => {
    const { element, commit, position } = setup()
    pointer(element.querySelector("button")!, "pointerdown", 320, 300)
    pointer(element, "pointermove", 380, 200)
    expect(position()).toEqual({ x: 50, y: 88 })
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))
    expect(position()).toEqual({ x: 50, y: 86 })
    expect(commit).toHaveBeenCalledExactlyOnceWith({ x: 50, y: 86 })
  })
})
