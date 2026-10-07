// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SiteRuleSavedNotice } from "../saved-notice"

const callbacks = () => ({ onUndo: vi.fn(), onManage: vi.fn(), onDismiss: vi.fn() })
const defaults = { pending: false, undoAvailable: true, error: null }
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("site rule saved notice", () => {
  it("dismisses after eight seconds without invoking rule mutations", () => {
    const actions = callbacks()
    render(<SiteRuleSavedNotice {...defaults} {...actions} />)
    advance(7999)
    expect(actions.onDismiss).not.toHaveBeenCalled()
    advance(1)
    expect(actions.onDismiss).toHaveBeenCalledOnce()
    expect(actions.onUndo).not.toHaveBeenCalled()
    expect(actions.onManage).not.toHaveBeenCalled()
  })

  it("pauses while hovered and resumes only the remaining time", () => {
    const actions = callbacks()
    render(<SiteRuleSavedNotice {...defaults} {...actions} />)
    advance(3000)
    fireEvent.pointerEnter(screen.getByRole("status"))
    advance(20000)
    expect(actions.onDismiss).not.toHaveBeenCalled()
    fireEvent.pointerLeave(screen.getByRole("status"))
    advance(4999)
    expect(actions.onDismiss).not.toHaveBeenCalled()
    advance(1)
    expect(actions.onDismiss).toHaveBeenCalledOnce()
  })

  it("keeps paused when focus moves between controls, even after the pointer leaves", () => {
    const actions = callbacks()
    render(<SiteRuleSavedNotice {...defaults} {...actions} />)
    advance(2000)
    const undo = screen.getByRole("button", { name: "siteRuleAgent.undo" })
    const manage = screen.getByRole("link", { name: "siteRuleAgent.viewRules" })
    fireEvent.pointerEnter(screen.getByRole("status"))
    act(() => undo.focus())
    fireEvent.pointerLeave(screen.getByRole("status"))
    advance(12000)
    act(() => manage.focus())
    advance(12000)
    expect(actions.onDismiss).not.toHaveBeenCalled()
    act(() => manage.blur())
    advance(5999)
    expect(actions.onDismiss).not.toHaveBeenCalled()
    advance(1)
    expect(actions.onDismiss).toHaveBeenCalledOnce()
  })

  it("does not spend its remaining time while the page is in the background", () => {
    const actions = callbacks()
    render(<SiteRuleSavedNotice {...defaults} {...actions} />)
    advance(5000)
    vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    fireEvent(document, new Event("visibilitychange"))
    advance(20000)
    expect(actions.onDismiss).not.toHaveBeenCalled()
    vi.spyOn(document, "hidden", "get").mockReturnValue(false)
    fireEvent(document, new Event("visibilitychange"))
    advance(3000)
    expect(actions.onDismiss).toHaveBeenCalledOnce()
  })

  it("pauses for operations and errors without resetting elapsed time", () => {
    const actions = callbacks()
    const { rerender } = render(<SiteRuleSavedNotice {...defaults} {...actions} />)
    advance(4000)
    rerender(<SiteRuleSavedNotice {...defaults} {...actions} pending />)
    advance(12000)
    rerender(<SiteRuleSavedNotice {...defaults} {...actions} error="Navigation failed" />)
    advance(12000)
    expect(screen.getByRole("alert")).toHaveTextContent("Navigation failed")
    expect(actions.onDismiss).not.toHaveBeenCalled()
    rerender(<SiteRuleSavedNotice {...defaults} {...actions} />)
    advance(4000)
    expect(actions.onDismiss).toHaveBeenCalledOnce()
  })

  it("keeps undo, settings navigation and close independent, and blocks actions while pending", () => {
    const actions = callbacks()
    const { rerender } = render(<SiteRuleSavedNotice {...defaults} {...actions} pending />)
    const undo = screen.getByRole("button", { name: "siteRuleAgent.undo" })
    const manage = screen.getByRole("link", { name: "siteRuleAgent.viewRules" })
    expect(manage).toHaveAttribute("href", expect.stringContaining("/options.html?siteRulesTab=custom#reading/site-rules"))
    fireEvent.click(undo)
    fireEvent.click(manage)
    expect(actions.onUndo).not.toHaveBeenCalled()
    expect(actions.onManage).not.toHaveBeenCalled()
    rerender(<SiteRuleSavedNotice {...defaults} {...actions} />)
    fireEvent.click(undo)
    fireEvent.click(manage)
    fireEvent.click(screen.getByRole("button", { name: "siteRuleAgent.close" }))
    expect(actions.onUndo).toHaveBeenCalledOnce()
    expect(actions.onManage).toHaveBeenCalledOnce()
    expect(actions.onDismiss).toHaveBeenCalledOnce()
  })

  it("cancels an old timer on unmount and gives the next save a full eight seconds", () => {
    const first = callbacks()
    const { unmount } = render(<SiteRuleSavedNotice {...defaults} {...first} />)
    advance(6000)
    unmount()
    const next = callbacks()
    render(<SiteRuleSavedNotice {...defaults} {...next} />)
    advance(7999)
    expect(first.onDismiss).not.toHaveBeenCalled()
    expect(next.onDismiss).not.toHaveBeenCalled()
    advance(1)
    expect(next.onDismiss).toHaveBeenCalledOnce()
  })

  it("shows the successful undo feedback for a fresh three seconds and removes actions", () => {
    const actions = callbacks()
    const { rerender } = render(<SiteRuleSavedNotice {...defaults} {...actions} />)
    advance(5000)
    act(() => screen.getByRole("button", { name: "siteRuleAgent.undo" }).focus())
    fireEvent.click(screen.getByRole("button", { name: "siteRuleAgent.undo" }))
    rerender(<SiteRuleSavedNotice {...defaults} {...actions} undone />)
    expect(screen.getByRole("status")).toHaveTextContent("siteRuleAgent.undone")
    expect(screen.queryByRole("button", { name: "siteRuleAgent.undo" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "siteRuleAgent.viewRules" })).not.toBeInTheDocument()
    advance(2999)
    expect(actions.onDismiss).not.toHaveBeenCalled()
    advance(1)
    expect(actions.onDismiss).toHaveBeenCalledOnce()
  })
})
