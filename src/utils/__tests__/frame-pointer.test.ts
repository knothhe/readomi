// @vitest-environment jsdom
import { expect, it, vi } from "vitest"
import { hitPointer, samplePointer } from "../frame-pointer"

it("maps both directions through a padded, scaled iframe inside an open shadow root", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = host.attachShadow({ mode: "open" })
  const frame = document.createElement("iframe")
  root.append(frame)
  frame.style.padding = "12px 20px"
  Object.defineProperties(frame, {
    offsetWidth: { value: 400 }, offsetHeight: { value: 200 },
    clientLeft: { value: 2 }, clientTop: { value: 4 },
  })
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 50, 200, 150))
  const paragraph = document.createElement("p")
  const innerHit = vi.fn(() => paragraph)
  const outerHit = vi.fn(() => host)
  const saved = document.elementFromPoint
  document.elementFromPoint = outerHit
  root.elementFromPoint = vi.fn(() => frame)
  vi.stubGlobal("window", { frameElement: frame, parent: window, top: window })
  vi.stubGlobal("document", { elementFromPoint: innerHit })
  try {
    samplePointer({ isTrusted: true, type: "mousemove", clientX: 10, clientY: 8, timeStamp: 1 } as MouseEvent)
    const point = window.__READOMI_POINTER__!
    expect(point).toMatchObject({ x: 116, y: 68, topCoordinates: true })
    expect(hitPointer(point)).toBe(paragraph)
    expect(innerHit).toHaveBeenCalledWith(10, 8)
    expect(root.elementFromPoint).toHaveBeenCalledWith(116, 68)
  }
  finally {
    vi.unstubAllGlobals()
    document.elementFromPoint = saved
    host.remove()
  }
})
