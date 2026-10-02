// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { QualityHelp } from "./help"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("quality help", () => {
  it("stays hidden by default and lets keyboard users read and dismiss it", () => {
    render(<QualityHelp label="Page summary" text="Summarizes page text." />)
    expect(screen.queryByRole("tooltip")).toBeNull()
    const button = screen.getByRole("button")
    act(() => button.focus())
    const tooltip = screen.getByRole("tooltip")
    expect(tooltip).toHaveTextContent("Summarizes page text.")
    expect(button).toHaveAttribute("aria-describedby", tooltip.id)
    fireEvent.keyDown(button, { key: "Escape" })
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("lets the pointer move into the help so users can read and select its text", () => {
    vi.useFakeTimers()
    render(<QualityHelp label="Prompt" text="Shared by pages and subtitles." />)
    const button = screen.getByRole("button")
    fireEvent.mouseEnter(button)
    const tooltip = screen.getByRole("tooltip")
    fireEvent.mouseLeave(button)
    fireEvent.mouseEnter(tooltip)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByRole("tooltip")).toBeVisible()
    fireEvent.mouseLeave(tooltip)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("opens by click outside the clipped card and closes on an outside tap", () => {
    const { container } = render(<div style={{ overflow: "hidden" }}><QualityHelp label="Prompt" text="Translation rules." /></div>)
    fireEvent.click(screen.getByRole("button"))
    const tooltip = screen.getByRole("tooltip")
    expect(container.contains(tooltip)).toBe(false)
    expect(tooltip.parentElement).toBe(document.body)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("tooltip")).toBeNull()
  })
})
