// @vitest-environment jsdom
import type { VideoTranslationControls } from "../translation-controls"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_FONT_SIZE_MAX, SUBTITLE_FONT_SIZE_MIN } from "@/types/config/subtitle-style"
import { createVideoTranslationControls } from "../translation-controls"

const live = new Set<VideoTranslationControls>()
let roots: WeakMap<Element, ShadowRoot>

function rect(left = 20, top = 30, width = 640, height = 360): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }
}

function player(youtube = true) {
  const container = document.createElement("div")
  if (youtube)
    container.className = "html5-video-player"
  const video = document.createElement("video")
  video.controls = true
  const chrome = document.createElement("div")
  chrome.className = "ytp-chrome-bottom"
  const controls = document.createElement("div")
  controls.className = "ytp-right-controls"
  const native = document.createElement("button")
  native.textContent = "Native settings"
  controls.append(native)
  chrome.append(controls)
  container.append(video)
  if (youtube)
    container.append(chrome)
  document.body.append(container)
  let geometry = rect()
  vi.spyOn(video, "getBoundingClientRect").mockImplementation(() => geometry)
  vi.spyOn(container, "getBoundingClientRect").mockImplementation(() => geometry)
  vi.spyOn(chrome, "getBoundingClientRect").mockImplementation(() => rect(geometry.left, geometry.bottom - 59, geometry.width, 59))
  vi.spyOn(controls, "getBoundingClientRect").mockImplementation(() => rect(geometry.right - 80, geometry.bottom - 59, 80, 59))
  const onToggle = vi.fn()
  const onStyleChange = vi.fn()
  const create = () => {
    const instance = createVideoTranslationControls(video, { enabled: true, excluded: false, appearance: DEFAULT_SUBTITLE_STYLE, onToggle, onStyleChange })
    live.add(instance)
    const host = document.querySelector<HTMLElement>("[data-readomi-video-controls]")!
    const shadow = roots.get(host)!
    const button = (selector: string) => shadow.querySelector<HTMLButtonElement>(selector)!
    return { instance, host, shadow, button }
  }
  return {
    container,
    video,
    controls,
    native,
    onToggle,
    onStyleChange,
    create,
    geometry: (next: DOMRect) => {
      geometry = next
    },
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  roots = new WeakMap()
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, options) {
    const shadow = attachShadow.call(this, options)
    roots.set(this, shadow)
    return shadow
  })
})

afterEach(() => {
  for (const instance of live)
    instance.dispose()
  live.clear()
  Reflect.deleteProperty(document, "fullscreenElement")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("video translation controls", () => {
  it("mounts first in the native right tools without requiring TrustedHTML or captions", () => {
    const fixture = player()
    vi.spyOn(Element.prototype, "innerHTML", "set").mockImplementation(() => {
      throw new TypeError("TrustedHTML required")
    })
    const { host, button } = fixture.create()
    expect(fixture.controls.firstElementChild).toBe(host)
    expect(host.shadowRoot).toBeNull()
    expect(button(".toggle")).toHaveAttribute("aria-pressed", "true")
    expect(button(".toggle")).toHaveAttribute("aria-label", "videoTranslationControls.disable")
    expect(button(".trigger").querySelector("img")).not.toBeNull()
    expect(button(".trigger")).toHaveTextContent("")
    expect(roots.get(host)!.querySelectorAll(".dock button")).toHaveLength(2)
    button(".toggle").click()
    expect(fixture.onToggle).toHaveBeenCalledWith(false)
    expect(fixture.native.isConnected).toBe(true)
  })

  it("prevents excluded sites from being enabled and updates from runtime state", () => {
    const fixture = player()
    const { instance, button, shadow } = fixture.create()
    instance.update({ excluded: true })
    expect(button(".toggle")).toBeDisabled()
    expect(button(".toggle")).toHaveAttribute("aria-pressed", "false")
    expect(shadow.querySelector(".excluded")).not.toHaveAttribute("hidden")
    button(".toggle").click()
    expect(fixture.onToggle).not.toHaveBeenCalled()
    instance.update({ excluded: false, enabled: false })
    expect(button(".toggle")).not.toBeDisabled()
    expect(button(".toggle")).toHaveAttribute("aria-label", "videoTranslationControls.enable")
    button(".toggle").click()
    expect(fixture.onToggle).toHaveBeenCalledWith(true)
  })

  it("sends preset and size changes through runtime without drifting from its committed state", () => {
    const fixture = player()
    const { instance, button, shadow } = fixture.create()
    button(".trigger").click()
    button("[data-preset=compact]").click()
    expect(fixture.onStyleChange).toHaveBeenLastCalledWith({ preset: "compact", fontSize: 16 })
    expect(button("[data-preset=clear]")).toHaveAttribute("aria-pressed", "true")
    expect(shadow.querySelector("output")).toHaveTextContent("20 px")
    instance.update({ appearance: { ...DEFAULT_SUBTITLE_STYLE, preset: "compact", fontSize: 16 } })
    expect(button("[data-preset=compact]")).toHaveAttribute("aria-pressed", "true")
    button(".larger").click()
    expect(fixture.onStyleChange).toHaveBeenLastCalledWith({ fontSize: 17 })
    button(".reset").click()
    expect(fixture.onStyleChange).toHaveBeenLastCalledWith({ position: { x: 50, y: 88 } })
    instance.update({ appearance: { ...DEFAULT_SUBTITLE_STYLE, fontSize: SUBTITLE_FONT_SIZE_MIN } })
    expect(button(".smaller")).toBeDisabled()
    instance.update({ appearance: { ...DEFAULT_SUBTITLE_STYLE, fontSize: SUBTITLE_FONT_SIZE_MAX, fontSizeMode: "fixed" } })
    expect(button(".larger")).toBeDisabled()
    button("[data-preset=compact]").click()
    expect(fixture.onStyleChange).toHaveBeenLastCalledWith({ preset: "compact", fontSize: 20 })
    instance.update({ saveFailed: true })
    expect(shadow.querySelector(".error[role=status]")).toHaveTextContent("videoTranslationControls.saveFailed")
    expect(shadow.querySelector(".error[role=status]")).not.toHaveAttribute("hidden")
  })

  it("supports keyboard presets, preserves internal presses, and closes on Escape or outside presses", () => {
    const fixture = player()
    const { host, button, shadow } = fixture.create()
    const hostClick = vi.fn()
    fixture.container.addEventListener("click", hostClick)
    button(".trigger").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true, cancelable: true }))
    expect(shadow.activeElement).toBe(button("[data-preset=clear]"))
    button("[data-preset=clear]").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true, cancelable: true }))
    expect(shadow.activeElement).toBe(button("[data-preset=compact]"))
    expect(fixture.onStyleChange).toHaveBeenLastCalledWith({ preset: "compact", fontSize: 16 })
    expect(hostClick).not.toHaveBeenCalled()
    button("[data-preset=compact]").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }))
    expect(button(".trigger")).toHaveAttribute("aria-expanded", "true")
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(button(".trigger")).toHaveAttribute("aria-expanded", "false")
    expect(shadow.activeElement).toBe(button(".trigger"))
    button(".trigger").click()
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }))
    expect(button(".trigger")).toHaveAttribute("aria-expanded", "false")
    expect(host.isConnected).toBe(true)
    fixture.native.click()
    expect(hostClick).toHaveBeenCalledOnce()
  })

  it("hides an open menu with YouTube's toolbar and remounts replaced native rows", () => {
    const fixture = player()
    const { instance, host, button, shadow } = fixture.create()
    fixture.container.classList.add("ytp-autohide")
    instance.tick()
    expect(host).toHaveAttribute("data-idle")
    expect(host).toHaveAttribute("aria-hidden", "true")
    expect(host).toHaveAttribute("inert")
    button(".trigger").click()
    expect(host.parentElement).toBe(document.documentElement)
    expect(host).toHaveAttribute("data-idle")
    expect(host).toHaveAttribute("inert")
    expect(host.dataset.placement).toBe("portal")
    expect(shadow.querySelector(".panel")).not.toHaveAttribute("hidden")
    expect(fixture.controls.querySelectorAll("[data-readomi-controls-anchor]")).toHaveLength(1)
    const anchor = fixture.controls.querySelector<HTMLElement>("[data-readomi-controls-anchor]")!
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect(460, 346, 148, 40))
    instance.tick()
    expect(host.style.left).toBe("460px")
    expect(host.style.top).toBe("349px")
    fixture.container.classList.remove("ytp-autohide")
    instance.tick()
    expect(host).not.toHaveAttribute("data-idle")
    expect(host).not.toHaveAttribute("inert")
    expect(host.parentElement).toBe(document.documentElement)
    Object.defineProperty(document, "fullscreenElement", { value: fixture.container, configurable: true })
    document.dispatchEvent(new Event("fullscreenchange"))
    expect(host.parentElement).toBe(fixture.container)
    button(".trigger").click()
    expect(host.parentElement).toBe(fixture.controls)
    expect(fixture.controls.querySelector("[data-readomi-controls-anchor]")).toBeNull()
    const replacement = document.createElement("div")
    replacement.className = "ytp-right-controls"
    vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue(rect(580, 331, 80, 59))
    fixture.controls.replaceWith(replacement)
    instance.tick()
    instance.tick()
    expect(replacement.firstElementChild).toBe(host)
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    expect(host).not.toHaveAttribute("data-hidden")
  })

  it("waits for a usable native toolbar instead of creating a floating fallback", () => {
    const fixture = player(false)
    const { instance, host } = fixture.create()
    expect(host.parentElement).toBe(document.documentElement)
    expect(host).toHaveAttribute("data-hidden")
    expect(host).toHaveAttribute("inert")
    expect(host.style.top).toBe("")
    expect(host.style.left).toBe("")
    const toolbar = document.createElement("div")
    toolbar.dataset.testid = "videoControls"
    toolbar.append(document.createElement("button"))
    fixture.container.append(toolbar)
    const bounds = vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue(rect(20, 330, 640, 60))
    instance.tick()
    expect(host.parentElement).toBe(toolbar)
    expect(host).not.toHaveAttribute("data-hidden")
    bounds.mockReturnValue(rect(20, 330, 0, 0))
    instance.tick()
    expect(host).toHaveAttribute("data-hidden")
    expect(host.parentElement).toBe(toolbar)
    bounds.mockReturnValue(rect(20, 330, 640, 60))
    instance.tick()
    expect(host).not.toHaveAttribute("data-hidden")
    Object.defineProperty(document, "fullscreenElement", { value: fixture.video, configurable: true })
    instance.tick()
    expect(host).toHaveAttribute("data-hidden")
    Reflect.deleteProperty(document, "fullscreenElement")
    instance.tick()
    expect(host.parentElement).toBe(toolbar)
    fixture.geometry(rect(20, 30, 0, 0))
    instance.tick()
    expect(host).toHaveAttribute("data-hidden")
    fixture.video.remove()
    instance.tick()
  })

  it("does not let pointer or keyboard focus override hidden native controls", () => {
    const fixture = player()
    const { instance, host, button } = fixture.create()
    const toggle = button(".toggle")
    toggle.focus()
    const focusVisible = vi.spyOn(toggle, "matches").mockReturnValue(false)
    fixture.container.classList.add("ytp-autohide")
    instance.tick()
    expect(host).toHaveAttribute("data-idle")
    expect(host.parentElement).toBe(fixture.controls)
    focusVisible.mockReturnValue(true)
    instance.tick()
    expect(host).toHaveAttribute("data-idle")
    expect(host.parentElement).toBe(fixture.controls)
    expect(host).toHaveAttribute("inert")
    fixture.container.classList.remove("ytp-autohide")
    instance.tick()
    expect(host).not.toHaveAttribute("data-idle")
    expect(host).not.toHaveAttribute("inert")
  })

  it("observes the native right group itself while the menu escapes its stacking context", async () => {
    const fixture = player()
    const { host, button } = fixture.create()
    button(".trigger").click()
    expect(host.parentElement).toBe(document.documentElement)
    fixture.controls.style.opacity = "0"
    await Promise.resolve()
    expect(host).toHaveAttribute("data-idle")
    expect(host).toHaveAttribute("inert")
    expect(fixture.controls.querySelector("[data-readomi-controls-anchor]")).not.toBeNull()
    fixture.controls.style.opacity = "1"
    await Promise.resolve()
    expect(host).not.toHaveAttribute("data-idle")
    fixture.controls.setAttribute("aria-hidden", "true")
    await Promise.resolve()
    expect(host).toHaveAttribute("data-idle")
    expect(host).toHaveAttribute("inert")
    fixture.controls.removeAttribute("aria-hidden")
    await Promise.resolve()
    expect(host).not.toHaveAttribute("data-idle")
    expect(host).not.toHaveAttribute("inert")
    expect(button(".trigger")).toHaveAttribute("aria-expanded", "true")
    button(".trigger").click()
    expect(host.parentElement).toBe(fixture.controls)
  })

  it("follows native control visibility even on paused videos and does not add a competing idle timer", async () => {
    vi.useFakeTimers()
    const fixture = player(false)
    const nativeControls = document.createElement("div")
    nativeControls.dataset.testid = "videoControls"
    const play = document.createElement("button")
    nativeControls.append(play)
    fixture.container.append(nativeControls)
    vi.spyOn(nativeControls, "getBoundingClientRect").mockReturnValue(rect(20, 330, 640, 60))
    const { instance, host, button } = fixture.create()
    expect(nativeControls.firstElementChild).toBe(play)
    expect(nativeControls.lastElementChild).toBe(host)
    nativeControls.style.opacity = "0"
    await Promise.resolve()
    expect(host).toHaveAttribute("data-idle")
    button(".trigger").click()
    expect(host).toHaveAttribute("data-idle")
    expect(host).toHaveAttribute("inert")
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(false)
    button(".trigger").click()
    expect(host).toHaveAttribute("data-idle")
    nativeControls.style.opacity = "1"
    await Promise.resolve()
    expect(host).not.toHaveAttribute("data-idle")
    Object.defineProperty(fixture.video, "paused", { value: false, configurable: true })
    vi.advanceTimersByTime(5000)
    instance.tick()
    expect(host).not.toHaveAttribute("data-idle")
    fixture.container.style.visibility = "hidden"
    await Promise.resolve()
    expect(host).toHaveAttribute("data-idle")
  })

  it("joins the X right tools before fullscreen and preserves that slot while a menu is open", () => {
    const fixture = player(false)
    fixture.container.dataset.testid = "videoComponent"
    const toolbar = document.createElement("div")
    toolbar.dataset.testid = "videoControls"
    toolbar.style.display = "flex"
    toolbar.style.gap = "8px"
    const play = document.createElement("button")
    play.textContent = "Ⅱ"
    const time = document.createElement("span")
    time.textContent = "0:00 / 1:00"
    time.style.marginRight = "auto"
    const fullscreen = document.createElement("button")
    fullscreen.textContent = "⛶"
    toolbar.append(play, time, fullscreen)
    fixture.container.append(toolbar)
    vi.spyOn(toolbar, "getBoundingClientRect").mockImplementation(() => {
      const videoRect = fixture.video.getBoundingClientRect()
      return rect(videoRect.left, videoRect.bottom - 60, videoRect.width, 60)
    })
    vi.spyOn(play, "getBoundingClientRect").mockReturnValue(rect(20, 330, 24, 34))
    vi.spyOn(time, "getBoundingClientRect").mockReturnValue(rect(52, 330, 80, 34))
    vi.spyOn(fullscreen, "getBoundingClientRect").mockReturnValue(rect(628, 330, 24, 34))
    const { instance, host, button } = fixture.create()
    expect(host.parentElement).toBe(toolbar)
    expect(toolbar.firstElementChild).toBe(play)
    expect(host.previousElementSibling).toBe(time)
    expect(host.nextElementSibling).toBe(fullscreen)
    button(".trigger").click()
    expect(host.parentElement).toBe(document.documentElement)
    expect(fullscreen.previousElementSibling).toHaveAttribute("data-readomi-controls-anchor")
    button(".trigger").click()
    expect(host.nextElementSibling).toBe(fullscreen)
    expect(toolbar.querySelector("[data-readomi-controls-anchor]")).toBeNull()
    fixture.geometry(rect(20, 30, 320, 180))
    instance.tick()
    expect(button(".trigger").querySelector("img")).not.toBeNull()
    expect(host.parentElement).toBe(toolbar)
    expect(host.nextElementSibling).toBe(fullscreen)
    const rightTools = document.createElement("div")
    rightTools.append(fullscreen)
    toolbar.append(rightTools)
    instance.tick()
    expect(toolbar.firstElementChild).toBe(play)
    expect(host.nextElementSibling).toBe(rightTools)
    expect(rightTools.firstElementChild).toBe(fullscreen)
    instance.dispose()
    expect(play.isConnected && time.isConnected && fullscreen.isConnected).toBe(true)
  })

  it("does not bind a body-level video to another player's native toolbar", () => {
    const other = player(false)
    const unrelated = document.createElement("div")
    unrelated.dataset.testid = "videoControls"
    other.container.append(unrelated)
    const video = document.createElement("video")
    document.body.append(video)
    Object.defineProperty(video, "paused", { value: false, configurable: true })
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(rect())
    const instance = createVideoTranslationControls(video, { enabled: true, excluded: false, appearance: DEFAULT_SUBTITLE_STYLE, onToggle: vi.fn(), onStyleChange: vi.fn() })
    live.add(instance)
    const host = document.querySelector<HTMLElement>("[data-readomi-video-controls]")!
    expect(host.parentElement).toBe(document.documentElement)
    expect(unrelated.querySelector("[data-readomi-video-controls]")).toBeNull()
    instance.tick()
    expect(host).toHaveAttribute("data-hidden")
    expect(host.style.top).toBe("")
  })

  it("hides when the native row disappears and returns to a replacement row without duplicating UI", () => {
    const fixture = player()
    const { instance, host, button } = fixture.create()
    button(".trigger").click()
    fixture.controls.remove()
    instance.tick()
    expect(host).toHaveAttribute("data-hidden")
    expect(host.style.top).toBe("")
    expect(host.style.left).toBe("")
    const replacement = document.createElement("div")
    replacement.className = "ytp-right-controls"
    const fullscreen = document.createElement("button")
    replacement.append(fullscreen)
    fixture.container.querySelector(".ytp-chrome-bottom")!.append(replacement)
    vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue(rect(580, 331, 80, 59))
    instance.tick()
    expect(host).not.toHaveAttribute("data-hidden")
    expect(fullscreen.previousElementSibling).toHaveAttribute("data-readomi-controls-anchor")
    button(".trigger").click()
    expect(host.parentElement).toBe(replacement)
    expect(host.nextElementSibling).toBe(fullscreen)
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    expect(document.querySelector("[data-readomi-controls-anchor]")).toBeNull()
  })

  it("hides crowded native controls without oscillating and returns to the same slot when the video widens", () => {
    const fixture = player()
    const leftControls = document.createElement("div")
    leftControls.className = "ytp-left-controls"
    const playback = document.createElement("button")
    leftControls.append(playback)
    fixture.controls.parentElement!.prepend(leftControls)
    vi.spyOn(fixture.native, "getBoundingClientRect").mockReturnValue(rect(20, 190, 90, 32))
    vi.spyOn(leftControls, "getBoundingClientRect").mockReturnValue(rect(20, 190, 192, 32))
    vi.spyOn(playback, "getBoundingClientRect").mockReturnValue(rect(20, 190, 192, 32))
    fixture.geometry(rect(20, 30, 358, 201))
    const { instance, host } = fixture.create()
    expect(host.dataset.placement).toBe("inline")
    expect(host.parentElement).toBe(fixture.controls)
    expect(host).toHaveAttribute("data-hidden")
    expect(host.style.top).toBe("")
    for (let count = 0; count < 3; count++) {
      instance.tick()
      expect(host.dataset.placement).toBe("inline")
      expect(host).toHaveAttribute("data-hidden")
    }
    fixture.geometry(rect())
    window.dispatchEvent(new Event("resize"))
    expect(host.dataset.placement).toBe("inline")
    expect(fixture.controls.firstElementChild).toBe(host)
    expect(host).not.toHaveAttribute("data-hidden")
  })

  it("fits beside YouTube's stretched flex left group and nested native right tools", () => {
    const fixture = player()
    fixture.geometry(rect(20, 30, 1761, 990))
    const chrome = fixture.controls.parentElement!
    vi.mocked(chrome.getBoundingClientRect).mockReturnValue(rect(32, 961, 1737, 59))
    const leftControls = document.createElement("div")
    leftControls.className = "ytp-left-controls"
    leftControls.style.display = "flex"
    leftControls.style.flex = "1 1 0%"
    const play = document.createElement("button")
    const volume = document.createElement("button")
    volume.style.marginRight = "12px"
    const time = document.createElement("span")
    const chapter = document.createElement("button")
    chapter.style.marginLeft = "5px"
    const hiddenPrevious = document.createElement("button")
    hiddenPrevious.style.display = "none"
    hiddenPrevious.style.marginLeft = "8px"
    leftControls.append(hiddenPrevious, play, volume, time, chapter)
    chrome.prepend(leftControls)
    vi.spyOn(leftControls, "getBoundingClientRect").mockReturnValue(rect(32, 961, 1489, 59))
    for (const [element, left, width] of [[play, 32, 40], [volume, 72, 40], [time, 124, 107], [chapter, 236, 176]] as const)
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect(left, 961, width, 59))
    fixture.controls.style.display = "flex"
    fixture.controls.style.flex = "0 1 auto"
    fixture.controls.style.paddingLeft = "4px"
    fixture.controls.style.paddingRight = "4px"
    const leftTools = document.createElement("div")
    const rightTools = document.createElement("div")
    rightTools.append(fixture.native)
    fixture.controls.replaceChildren(leftTools, rightTools)
    vi.mocked(fixture.controls.getBoundingClientRect).mockReturnValue(rect(1521, 961, 248, 59))
    vi.spyOn(leftTools, "getBoundingClientRect").mockReturnValue(rect(1521, 961, 144, 59))
    vi.spyOn(rightTools, "getBoundingClientRect").mockReturnValue(rect(1665, 961, 96, 59))
    const { instance, host, button } = fixture.create()
    for (let count = 0; count < 3; count++) {
      instance.tick()
      expect(host).not.toHaveAttribute("data-hidden")
      expect(host.parentElement).toBe(fixture.controls)
      expect(host.nextElementSibling).toBe(leftTools)
    }
    button(".trigger").click()
    expect(host).not.toHaveAttribute("data-hidden")
    expect(leftTools.previousElementSibling).toHaveAttribute("data-readomi-controls-anchor")
    button(".trigger").click()
    expect(host.nextElementSibling).toBe(leftTools)
    // Only rendered native items consume space, even when a hidden previous
    // button retains a margin in the page's stylesheet.
    vi.mocked(chrome.getBoundingClientRect).mockReturnValue(rect(32, 961, 724, 59))
    instance.tick()
    expect(host).not.toHaveAttribute("data-hidden")
    vi.mocked(chrome.getBoundingClientRect).mockReturnValue(rect(32, 961, 723, 59))
    instance.tick()
    expect(host).toHaveAttribute("data-hidden")
    expect(host.parentElement).toBe(fixture.controls)
  })

  it("replaces a previous instance and disposal stops remounting and removes global handlers", () => {
    const fixture = player()
    const first = fixture.create()
    const second = fixture.create()
    expect(first.host.isConnected).toBe(false)
    expect(document.querySelectorAll("[data-readomi-video-controls]")).toHaveLength(1)
    second.button(".trigger").click()
    second.instance.dispose()
    second.instance.dispose()
    second.instance.update({ saveFailed: true })
    second.instance.tick()
    document.dispatchEvent(new Event("fullscreenchange"))
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(false)
    expect(document.querySelector("[data-readomi-video-controls]")).toBeNull()
    expect(document.querySelector("[data-readomi-controls-anchor]")).toBeNull()
  })
})
