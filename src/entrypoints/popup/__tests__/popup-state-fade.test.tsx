// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PopupStateFade } from "../components/popup-state-fade"

const animations = vi.hoisted(() => [] as { complete: () => void, stop: ReturnType<typeof vi.fn> }[])
vi.mock("motion", () => ({
  animate: vi.fn(() => {
    let complete!: () => void
    const promise = new Promise<void>((resolve) => {
      complete = resolve
    })
    const stop = vi.fn()
    animations.push({ complete, stop })
    return Object.assign(promise, { stop })
  }),
}))

describe("popup state fade", () => {
  let reduced: boolean
  let preferenceChanged: () => void

  beforeEach(() => {
    animations.length = 0
    reduced = false
    vi.stubGlobal("matchMedia", () => ({
      get matches() { return reduced },
      addEventListener: (_type: string, callback: () => void) => { preferenceChanged = callback },
      removeEventListener: vi.fn(),
    }))
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 42))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function view(paused: boolean) {
    return (
      <>
        <button>Site switch</button>
        <PopupStateFade paused={paused}>
          <button id="translate" disabled={paused}>Translate</button>
        </PopupStateFade>
      </>
    )
  }

  it("keeps the real control and focus intact, with only an inert copy fading after the state commits", async () => {
    const { container, rerender } = render(view(false))
    const actual = screen.getByRole("button", { name: "Translate" })
    const site = screen.getByRole("button", { name: "Site switch" })
    site.focus()
    expect(animations).toHaveLength(0)
    rerender(view(true))
    expect(screen.getByRole("button", { name: "Translate" })).toBe(actual)
    expect(actual).toBeDisabled()
    expect(site).toHaveFocus()
    const overlay = container.querySelector<HTMLElement>(".popup-state-overlay")!
    expect(overlay).toHaveAttribute("aria-hidden", "true")
    expect(overlay.inert).toBe(true)
    expect(overlay.querySelector("button")).toBeEnabled()
    expect(container.querySelectorAll("#translate")).toHaveLength(1)
    await act(async () => animations[0].complete())
    expect(container.querySelector(".popup-state-overlay")).toBeNull()
    expect(actual).toBeDisabled()
  })

  it("cancels an interrupted fade and restores usability without replacing the control", async () => {
    const { container, rerender } = render(view(false))
    const actual = screen.getByRole("button", { name: "Translate" })
    rerender(view(true))
    rerender(view(false))
    expect(animations[0].stop).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Translate" })).toBe(actual)
    expect(actual).toBeEnabled()
    await act(async () => animations[0].complete())
    expect(container.querySelector(".popup-state-overlay")).not.toBeNull()
    await act(async () => animations[1].complete())
    expect(container.querySelector(".popup-state-overlay")).toBeNull()
  })

  it("switches directly with reduced motion and clears an active fade when the preference changes", () => {
    reduced = true
    const { container, rerender } = render(view(false))
    rerender(view(true))
    expect(animations).toHaveLength(0)
    expect(screen.getByRole("button", { name: "Translate" })).toBeDisabled()
    reduced = false
    rerender(view(false))
    expect(container.querySelector(".popup-state-overlay")).not.toBeNull()
    reduced = true
    preferenceChanged()
    expect(animations[0].stop).toHaveBeenCalledOnce()
    expect(container.querySelector(".popup-state-overlay")).toBeNull()
    expect(screen.getByRole("button", { name: "Translate" })).toBeEnabled()
  })

  it("stops the fade when the popup closes", () => {
    const { rerender, unmount } = render(view(false))
    rerender(view(true))
    unmount()
    expect(animations[0].stop).toHaveBeenCalledOnce()
  })
})
