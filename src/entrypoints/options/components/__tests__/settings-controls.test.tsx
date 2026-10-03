// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SettingsSelect } from "../settings-select"
import { SettingsSlider } from "../settings-slider"

const options = [
  { value: "one", label: "Alpha" },
  { value: "two", label: "Unavailable", disabled: true },
  { value: "three", label: "Beta" },
  { value: "four", label: "Bravo" },
]

afterEach(cleanup)

describe("settings select", () => {
  it("closes without resetting a form when the reader picks its current choice", () => {
    const changed = vi.fn()
    render(<SettingsSelect aria-label="Service type" value="one" options={options} onValueChange={changed} />)
    fireEvent.click(screen.getByRole("combobox"))
    fireEvent.click(screen.getByRole("option", { name: "Alpha" }))
    expect(changed).not.toHaveBeenCalled()
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("lets readers explore with arrows, skip unavailable choices, cancel and confirm without moving focus", () => {
    const changed = vi.fn()
    render(<SettingsSelect aria-label="Service" value="one" options={options} onValueChange={changed} />)
    const trigger = screen.getByRole("combobox", { name: "Service" })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(changed).not.toHaveBeenCalled()
    expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Beta" }).id)
    fireEvent.keyDown(trigger, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(changed).not.toHaveBeenCalled()
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    fireEvent.keyDown(trigger, { key: "Enter" })
    expect(changed).toHaveBeenCalledExactlyOnceWith("three")
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  it("supports typeahead and Tab confirmation, and closes on an outside press", () => {
    const changed = vi.fn()
    render(<SettingsSelect aria-label="Language" value="one" options={options} onValueChange={changed} />)
    const trigger = screen.getByRole("combobox")
    fireEvent.keyDown(trigger, { key: "b" })
    expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Beta" }).id)
    fireEvent.keyDown(trigger, { key: "r" })
    expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Bravo" }).id)
    fireEvent.keyDown(trigger, { key: "Tab" })
    expect(changed).toHaveBeenCalledExactlyOnceWith("four")
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("disables choices during a save and removes a menu when its retained section becomes hidden", async () => {
    const changed = vi.fn()
    const view = render(<div><SettingsSelect aria-label="Format" value="one" options={options} onValueChange={changed} /></div>)
    const trigger = screen.getByRole("combobox")
    fireEvent.click(trigger)
    view.rerender(<div hidden><SettingsSelect aria-label="Format" value="one" options={options} onValueChange={changed} /></div>)
    await vi.waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
    view.rerender(<div><SettingsSelect aria-label="Format" value="one" options={options} onValueChange={changed} disabled /></div>)
    expect(screen.getByRole("combobox")).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(changed).not.toHaveBeenCalled()
    view.rerender(<div><SettingsSelect aria-label="Format" value="one" options={options} onValueChange={changed} /></div>)
    fireEvent.click(screen.getByRole("combobox"))
    view.rerender(<div><SettingsSelect aria-label="Format" value="one" options={options} onValueChange={changed} disabled /></div>)
    await vi.waitFor(() => expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false"))
    view.rerender(<div><SettingsSelect aria-label="Format" value="one" options={options} onValueChange={changed} /></div>)
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

function Slider() {
  const [value, setValue] = useState(15)
  return <SettingsSlider aria-label="Font size" value={value} min={14} max={16} onValueChange={setValue} unit="px" decrementLabel="Smaller" incrementLabel="Larger" />
}

describe("settings slider", () => {
  it("keeps range semantics and lets readers make precise changes within the allowed limits", () => {
    render(<Slider />)
    const range = screen.getByRole("slider", { name: "Font size" })
    fireEvent.click(screen.getByRole("button", { name: "Larger" }))
    expect(range).toHaveValue("16")
    expect(range).toHaveAttribute("aria-valuetext", "16 px")
    expect(screen.getByRole("button", { name: "Larger" })).toBeDisabled()
    fireEvent.change(range, { target: { value: "14" } })
    expect(screen.getByRole("button", { name: "Smaller" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Larger" }))
    expect(range).toHaveValue("15")
  })
})
