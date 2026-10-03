// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ShortcutKeyRecorder } from "../shortcut-key-recorder"

vi.mock("#imports", () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

describe("shortcut key recorder", () => {
  it("shows each configured key as an individual keycap and begins recording on activation", () => {
    const onChange = vi.fn()
    render(<ShortcutKeyRecorder shortcutKey="Alt+Shift+K" onChange={onChange} />)
    const button = screen.getByRole("button")
    expect(button.querySelectorAll("kbd")).toHaveLength(3)
    expect(button.querySelector("kbd:last-child")).toHaveTextContent("K")
    fireEvent.focus(button)
    expect(button).toHaveAttribute("aria-pressed", "false")
    fireEvent.keyDown(document, { key: "e", altKey: true })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-pressed", "true")
    expect(button).toHaveTextContent("shortcutKeySelector.placeholder")
  })

  it("shows an unconfigured shortcut as a clickable unset keycap", () => {
    render(<ShortcutKeyRecorder shortcutKey="" />)
    expect(screen.getByRole("button")).toHaveTextContent("shortcutKeySelector.unset")
  })

  it("lets Tab leave the button and cancels recording", () => {
    const onChange = vi.fn()
    render(<ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} />)
    const button = screen.getByRole("button")
    fireEvent.click(button)
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    fireEvent(document, tabEvent)
    expect(tabEvent.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: "k", ctrlKey: true })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("cancels a mounted recorder when its settings section becomes hidden", async () => {
    const onChange = vi.fn()
    const view = render(<div><ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} /></div>)
    const button = screen.getByRole("button")
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-pressed", "true")

    view.rerender(<div hidden><ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} /></div>)
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"))
    expect(onChange).not.toHaveBeenCalled()
    expect(button).toHaveAttribute("data-shortcut", "Alt+E")
  })

  it("does not intercept another page's keys immediately after hiding", () => {
    const onChange = vi.fn()
    const view = render(<div><ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} /></div>)
    fireEvent.click(screen.getByRole("button"))
    view.rerender(<div hidden><ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} /></div>)

    const keyEvent = new KeyboardEvent("keydown", { key: "k", altKey: true, bubbles: true, cancelable: true })
    fireEvent(document, keyEvent)
    expect(keyEvent.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps the previous shortcut when the consumer rejects a conflicting combination", async () => {
    render(<ShortcutKeyRecorder shortcutKey="Alt+E" onChange={() => false} />)
    const button = screen.getByRole("button")
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: "m", altKey: true })
    await waitFor(() => expect(button).toHaveAttribute("data-shortcut", "Alt+E"))
  })
  it("records modifier shortcuts as portable strings", async () => {
    const onChange = vi.fn()

    render(<ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} />)

    const button = screen.getByRole("button")
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: "K", ctrlKey: true, shiftKey: true })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("Mod+Shift+K")
    })
  })

  it("uses the physical digit key for mac option combinations", async () => {
    const onChange = vi.fn()

    render(<ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} />)

    const button = screen.getByRole("button")
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: "£", altKey: true, code: "Digit3" })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("Alt+3")
    })
  })

  it("keeps recording after a single non-modifier key", async () => {
    const onChange = vi.fn()

    render(<ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} />)

    const button = screen.getByRole("button")
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: "K" })

    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled()
    })

    fireEvent.keyDown(document, { key: "E", altKey: true })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("Alt+E")
    })
  })

  it("cancels recording with Escape", async () => {
    const onChange = vi.fn()

    render(<ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} />)

    const button = screen.getByRole("button")
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: "Escape" })

    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled()
      expect(button).toHaveAttribute("data-shortcut", "Alt+E")
    })
  })

  it("clears the shortcut with Backspace and Delete", async () => {
    const onChange = vi.fn()

    render(<ShortcutKeyRecorder shortcutKey="Alt+E" onChange={onChange} />)

    const button = screen.getByRole("button")

    fireEvent.click(button)
    fireEvent.keyDown(document, { key: "Backspace" })

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("")
    })

    fireEvent.click(button)
    fireEvent.keyDown(document, { key: "Delete" })

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("")
    })
  })
})
