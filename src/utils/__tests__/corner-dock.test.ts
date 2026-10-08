// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { attachCornerHost } from "../corner-dock"

afterEach(() => document.querySelector("[data-readomi-corner-host]")?.remove())

describe("shared content-script corner dock", () => {
  it("keeps notifications above the panel even when the panel mounted first, and supports independent cleanup", () => {
    const panel = document.createElement("div")
    panel.setAttribute("data-readomi-site-rule-panel", "")
    const removePanel = attachCornerHost(panel)
    const inputToast = document.createElement("div")
    inputToast.setAttribute("data-readomi-host-toast", "")
    const removeInput = attachCornerHost(inputToast)
    const pageToast = document.createElement("div")
    pageToast.setAttribute("data-readomi-host-toast", "")
    const removePage = attachCornerHost(pageToast)
    const shared = document.querySelector("[data-readomi-corner-host]")!
    expect([...shared.children]).toEqual([inputToast, pageToast, panel])
    expect(document.querySelectorAll("[data-readomi-corner-host]")).toHaveLength(1)
    removeInput()
    expect([...shared.children]).toEqual([pageToast, panel])
    removePanel()
    expect(shared.isConnected).toBe(true)
    removePage()
    expect(shared.isConnected).toBe(false)
    removeInput()
    expect(document.querySelector("[data-readomi-corner-host]")).toBeNull()
  })
})
