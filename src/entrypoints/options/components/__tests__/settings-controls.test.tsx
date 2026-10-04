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
  it("can hide visible limits while retaining the native range limits", () => {
    const changed = vi.fn()
    const props = { value: 3, min: 1.25, max: 12.5, step: 0.25, onValueChange: changed, unit: "%", decrementLabel: "Smaller", incrementLabel: "Larger" }
    const view = render(<SettingsSlider {...props} aria-label="Relative size" />)
    expect(screen.getByText("1.25 %")).toBeInTheDocument()
    expect(screen.getByText("12.5 %")).toBeInTheDocument()
    view.rerender(<SettingsSlider {...props} aria-label="Relative size" showLimits={false} />)
    expect(screen.queryByText("1.25 %")).toBeNull()
    expect(screen.queryByText("12.5 %")).toBeNull()
    expect(screen.getByRole("slider")).toHaveAttribute("min", "1.25")
    expect(screen.getByRole("slider")).toHaveAttribute("max", "12.5")
    fireEvent.click(screen.getByRole("button", { name: "Larger" }))
    expect(changed).toHaveBeenLastCalledWith(3.25)
  })

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

  it("lets readers type a number without saving incomplete input and clamps it on confirmation", () => {
    render(<Slider />)
    const number = screen.getByRole("spinbutton", { name: "Font size" })
    const range = screen.getByRole("slider", { name: "Font size" })
    fireEvent.change(number, { target: { value: "" } })
    expect(range).toHaveValue("15")
    fireEvent.blur(number)
    expect(number).toHaveValue(15)
    fireEvent.change(number, { target: { value: "80" } })
    expect(range).toHaveValue("15")
    fireEvent.blur(number)
    expect(number).toHaveValue(16)
    fireEvent.change(number, { target: { value: "14" } })
    fireEvent.keyDown(number, { key: "Escape" })
    fireEvent.blur(number)
    expect(range).toHaveValue("16")
  })

  it("preserves an older fractional percentage and disables all edits when its setting is off", () => {
    const change = vi.fn()
    const view = render(<SettingsSlider aria-label="Relative size" value={3.125} min={1.25} max={12.5} step={0.25} onValueChange={change} unit="%" decrementLabel="Smaller" incrementLabel="Larger" />)
    expect(screen.getByRole("spinbutton")).toHaveValue(3.125)
    fireEvent.click(screen.getByRole("button", { name: "Larger" }))
    expect(change).toHaveBeenLastCalledWith(3.375)
    view.rerender(<SettingsSlider aria-label="Relative size" value={3.125} min={1.25} max={12.5} step={0.25} onValueChange={change} unit="%" decrementLabel="Smaller" incrementLabel="Larger" disabled />)
    expect(screen.getByRole("slider")).toBeDisabled()
    expect(screen.getByRole("spinbutton")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Smaller" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Larger" })).toBeDisabled()
  })
})
