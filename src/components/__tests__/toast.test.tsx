// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dismiss, toast, Toasts } from "../toast"

vi.mock("@/components/brand-icon", () => ({ BrandIcon: () => <span /> }))

beforeEach(() => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe("corner toasts", () => {
  it("keeps the last dismissed toast inert for its fade-out, then removes it", async () => {
    render(<Toasts />)
    act(() => {
      toast.error("Translation failed", { durationMs: 20000 })
    })
    const card = screen.getByRole("alert")
    fireEvent.click(screen.getByRole("button", { name: "siteRuleAgent.close" }))
    expect(card).toHaveAttribute("inert")
    expect(card).toHaveAttribute("aria-hidden", "true")
    await waitFor(() => expect(card).not.toBeInTheDocument())
    expect(screen.getByRole("region")).toBeEmptyDOMElement()
  })

  it("pauses a toast for hover, focus and a hidden page, then spends only its remaining time", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
    render(<Toasts />)
    act(() => {
      toast.error("Translation failed")
    })
    const card = screen.getByRole("alert")
    advance(1000)
    fireEvent.pointerEnter(card)
    advance(9000)
    act(() => screen.getByRole("button").focus())
    fireEvent.pointerLeave(card)
    advance(9000)
    act(() => screen.getByRole("button").blur())
    advance(1000)
    vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    fireEvent(document, new Event("visibilitychange"))
    advance(9000)
    expect(card).not.toHaveAttribute("inert")
    vi.spyOn(document, "hidden", "get").mockReturnValue(false)
    fireEvent(document, new Event("visibilitychange"))
    advance(1999)
    expect(card).not.toHaveAttribute("inert")
    advance(1)
    expect(card).toHaveAttribute("inert")
  })

  it("keeps error details collapsed by default and renders their text safely", async () => {
    render(<Toasts />)
    const errorDetails = "Error: <img src='x' onerror='alert(1)'> & request failed"
    act(() => {
      toast.error("Translation failed", { description: "Please retry", errorDetails })
    })

    const card = screen.getByRole("alert")
    const summary = screen.getByText("errorRecovery.errorDetails")
    const details = summary.closest("details")!
    expect(details.open).toBe(false)
    await waitFor(() => expect(screen.getByText("Please retry")).toBeVisible())
    expect(screen.getByText(errorDetails)).not.toBeVisible()
    expect(card.querySelector("img")).toBeNull()
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    expect(screen.getByText(errorDetails)).toBeVisible()
    expect(card.querySelector("img")).toBeNull()
  })

  it("pauses while error details remain expanded after focus leaves and resumes the remaining time on collapse", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
    render(<Toasts />)
    act(() => {
      toast.error("Translation failed", { errorDetails: "Error: Offline" })
    })
    const card = screen.getByRole("alert")
    const summary = screen.getByText("errorRecovery.errorDetails")
    const details = summary.closest("details")!
    advance(1000)
    fireEvent.click(summary)
    // JSDOM queues native toggle events separately from the mocked timers.
    fireEvent(details, new Event("toggle"))
    expect(details).toHaveAttribute("open")
    act(() => summary.focus())
    act(() => summary.blur())
    advance(9000)
    expect(card).not.toHaveAttribute("inert")

    fireEvent.click(summary)
    fireEvent(details, new Event("toggle"))
    expect(details).not.toHaveAttribute("open")
    advance(2999)
    expect(card).not.toHaveAttribute("inert")
    advance(1)
    expect(card).toHaveAttribute("inert")
  })

  it("keeps another toast's timer independent and clears stale feedback on root cleanup", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
    const { unmount } = render(<Toasts />)
    let first = 0
    act(() => {
      first = toast.success("Saved")
    })
    advance(1000)
    act(() => {
      toast.error("Failed")
    })
    advance(1000)
    act(() => dismiss(first))
    advance(2999)
    expect(screen.getByRole("alert")).toHaveTextContent("Failed")
    advance(1)
    expect(screen.queryByRole("alert")).toBeNull()
    act(() => {
      toast.error("Stale error")
    })
    unmount()
    render(<Toasts />)
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
