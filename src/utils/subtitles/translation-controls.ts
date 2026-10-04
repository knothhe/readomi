import type { SubtitleStyle } from "@/types/config/subtitle-style"
import { browser, i18n } from "#imports"
import { SUBTITLE_PRESETS } from "@/types/config/subtitle-style"
import { formatSubtitleFontSize, isSubtitlePresetModified, SUBTITLE_POSITIONS, subtitlePresetPatch, subtitleSizePatch, subtitleSizeSettings } from "./appearance"
import { xVideoContainer, xVideoControls, xVideoToolsStart } from "./x-player"

export interface VideoTranslationControlsState {
  enabled: boolean
  excluded: boolean
  appearance: SubtitleStyle
  saveFailed?: boolean
}

interface VideoTranslationControlsOptions extends VideoTranslationControlsState {
  onToggle: (enabled: boolean) => void
  onStyleChange: (patch: Partial<SubtitleStyle>) => void
}

export interface VideoTranslationControls {
  update: (state: Partial<VideoTranslationControlsState>) => void
  tick: () => void
  dispose: () => void
}

const mountedControls = new WeakMap<HTMLVideoElement, VideoTranslationControls>()

const CONTROL_CSS = `
:host{all:initial;position:fixed!important;z-index:2147483647!important;display:block!important;width:max-content!important;box-sizing:border-box!important;border:0!important;padding:0!important;margin:0!important;background:transparent!important;overflow:visible!important;transform:none!important;bottom:auto!important;right:auto!important;pointer-events:none!important;direction:ltr!important;color-scheme:dark!important;font:12px system-ui!important}
:host([data-placement=inline]){position:relative!important;display:inline-flex!important;align-items:center!important;height:100%!important;vertical-align:middle!important;margin-right:8px!important;flex-shrink:0!important}
:host([data-toolbar=x][data-placement=inline]){height:auto!important}
:host([data-hidden]){display:none!important}
.dock,.panel{opacity:1;visibility:visible;transition:opacity 180ms ease,visibility 0s}
:host([data-idle]) .dock,:host([data-idle]) .panel{opacity:0;visibility:hidden;pointer-events:none!important;transition:opacity 180ms ease,visibility 0s linear 180ms}
@media(prefers-reduced-motion:reduce){.dock,.panel,:host([data-idle]) .dock,:host([data-idle]) .panel{transition:none}}
*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #e8b29b;outline-offset:3px}button:disabled{opacity:.45;cursor:default}[hidden]{display:none!important}
.dock{display:flex;align-items:center;gap:8px;min-height:34px;padding:5px 8px;border:1px solid #ffffff21;border-radius:8px;background:#181a20e6;color:white;box-shadow:0 3px 12px #0003;pointer-events:auto;white-space:nowrap}
.logo{width:18px;height:18px;display:block;flex-shrink:0}.toggle{display:grid;place-items:center;width:32px;height:20px;padding:3px;border:0;border-radius:12px;background:#ffffff38}.toggle span{width:14px;height:14px;border-radius:50%;background:#fff;justify-self:start;box-shadow:0 1px 2px #0003}.toggle[aria-pressed=true]{background:#b6533e}.toggle[aria-pressed=true] span{justify-self:end}
.trigger{display:grid;place-items:center;width:22px;height:22px;border:0;border-radius:4px;background:transparent;padding:2px;color:#fff}.trigger:hover,.trigger[aria-expanded=true]{background:#ffffff14}.excluded{display:block;margin:0 0 10px;font-size:11px;color:#d5d3d1;line-height:1.5}
.panel{position:fixed;width:240px;background:#1a1d24f7;border:1px solid #ffffff26;border-radius:10px;padding:14px;color:white;box-shadow:0 6px 24px #0005;pointer-events:auto;overflow:auto;overscroll-behavior:contain}.panel h2{font-size:12px;font-weight:550;margin:0 0 12px}.presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.presets button{min-width:0;background:#ffffff12;border:1px solid #ffffff20;border-radius:6px;color:#dfdfdf;font-size:12px;line-height:1.35;padding:8px 6px;white-space:normal;overflow-wrap:anywhere}.presets button[aria-pressed=true]{border-color:#cc8a6d;background:#b6533e45;color:#ffe5d8}
.size-row{display:flex;align-items:center;margin:14px 0;padding-top:12px;border-top:1px solid #ffffff20;gap:9px}.size-label{font-size:11px;margin-right:auto;color:#d1d0ce}.size-row button{width:25px;height:25px;background:#ffffff12;border:1px solid #ffffff24;border-radius:5px;color:white;font-size:15px;line-height:1}.size-row output{font-size:12px;min-width:40px;font-variant-numeric:tabular-nums;text-align:center}.reset{width:100%;background:transparent;border:0;border-top:1px solid #ffffff20;padding:12px 0 0;text-align:left;color:#dbd8d6;font-size:11px}.error{margin:12px 0 0;font-size:11px;line-height:1.5;color:#f4bcaa}
:host([data-narrow]) .dock{gap:6px;padding:5px 6px;min-height:31px}
:host([data-narrow]) .trigger{width:20px;height:20px;padding:1px}:host([data-narrow]) .toggle{width:28px;height:18px;padding:2px}
:host([data-narrow]) .panel{padding:8px}:host([data-narrow]) .panel h2{display:none}:host([data-narrow]) .presets button{padding:5px 6px}:host([data-narrow]) .size-row{margin:6px 0;padding-top:6px}:host([data-narrow]) .reset{padding-top:6px}
`

/** Independent from caption availability: the reader can enable translation before a cue arrives. */
export function createVideoTranslationControls(video: HTMLVideoElement, options: VideoTranslationControlsOptions): VideoTranslationControls {
  mountedControls.get(video)?.dispose()
  let state: VideoTranslationControlsState = options
  let disposed = false
  let menuOpen = false
  const owner = video.ownerDocument
  const view = owner.defaultView ?? window
  const host = owner.createElement("div")
  host.dataset.readomiVideoControls = ""
  host.className = "notranslate"
  host.setAttribute("translate", "no")
  const shadow = host.attachShadow({ mode: "closed" })
  const element = <T extends keyof HTMLElementTagNameMap>(tag: T, className = "") => {
    const node = owner.createElement(tag)
    node.className = className
    if (tag === "button")
      (node as HTMLButtonElement).type = "button"
    return node
  }
  const style = element("style")
  style.textContent = CONTROL_CSS
  // Keep the native row's geometry while the menu escapes its stacking context.
  // This is an inert placeholder owned by this controller, never a second UI.
  const anchor = element("span")
  anchor.dataset.readomiControlsAnchor = ""
  anchor.setAttribute("aria-hidden", "true")
  for (const [name, value] of Object.entries({ "display": "inline-flex", "height": "100%", "margin-right": "8px", "flex-shrink": "0", "padding": "0", "border": "0", "visibility": "hidden", "pointer-events": "none", "box-sizing": "border-box" }))
    anchor.style.setProperty(name, value, "important")
  const dock = element("div", "dock")
  dock.setAttribute("role", "group")
  const logo = element("img", "logo")
  logo.alt = ""
  logo.src = browser.runtime.getURL("/icon/terra/32.png")
  const toggle = element("button", "toggle")
  toggle.append(element("span"))
  const excluded = element("span", "excluded")
  excluded.setAttribute("role", "status")
  const trigger = element("button", "trigger")
  trigger.setAttribute("aria-controls", "readomi-preset-panel")
  trigger.setAttribute("aria-haspopup", "dialog")
  trigger.append(logo)
  dock.append(trigger, toggle)
  const panel = element("section", "panel")
  panel.id = "readomi-preset-panel"
  panel.setAttribute("role", "dialog")
  const heading = element("h2")
  const presets = element("div", "presets")
  presets.setAttribute("role", "group")
  const sizeRow = element("div", "size-row")
  const sizeCaption = element("span", "size-label")
  const sizeOutput = element("output")
  const smaller = element("button", "smaller")
  smaller.textContent = "−"
  const larger = element("button", "larger")
  larger.textContent = "+"
  sizeRow.append(sizeCaption, smaller, sizeOutput, larger)
  const reset = element("button", "reset")
  const error = element("p", "error")
  error.setAttribute("role", "status")
  panel.append(heading, excluded, presets, sizeRow, reset, error)
  shadow.append(style, dock, panel)
  const presetButtons = SUBTITLE_PRESETS.map((preset) => {
    const button = owner.createElement("button")
    button.type = "button"
    button.dataset.preset = preset
    button.addEventListener("click", () => options.onStyleChange(subtitlePresetPatch(preset, state.appearance.fontSizeMode)))
    presets.append(button)
    return button
  })

  const render = () => {
    const action = i18n.t(state.enabled && !state.excluded ? "videoTranslationControls.disable" : "videoTranslationControls.enable")
    dock.setAttribute("aria-label", i18n.t("videoTranslationControls.title"))
    dock.title = i18n.t("videoTranslationControls.scope")
    toggle.setAttribute("aria-label", action)
    toggle.title = state.excluded ? i18n.t("videoTranslationControls.excluded") : action
    toggle.setAttribute("aria-pressed", String(state.enabled && !state.excluded))
    toggle.disabled = state.excluded
    excluded.hidden = !state.excluded
    excluded.textContent = i18n.t("videoTranslationControls.excluded")
    trigger.setAttribute("aria-label", i18n.t("videoTranslationControls.presetButton"))
    trigger.title = i18n.t("videoTranslationControls.presetButton")
    trigger.setAttribute("aria-expanded", String(menuOpen))
    panel.hidden = !menuOpen
    panel.setAttribute("aria-label", i18n.t("subtitleStyle.preset"))
    heading.textContent = i18n.t("subtitleStyle.preset")
    presets.setAttribute("aria-label", i18n.t("subtitleStyle.preset"))
    for (const [index, preset] of SUBTITLE_PRESETS.entries()) {
      presetButtons[index].textContent = i18n.t(`subtitleStyle.presets.${preset}`)
      presetButtons[index].setAttribute("aria-pressed", String(state.appearance.preset === preset && !isSubtitlePresetModified(state.appearance)))
    }
    sizeCaption.textContent = i18n.t("subtitleStyle.fontSize")
    sizeOutput.textContent = formatSubtitleFontSize(state.appearance)
    const size = subtitleSizeSettings(state.appearance)
    for (const [button, label] of [[smaller, i18n.t("subtitleStyle.smaller")], [larger, i18n.t("subtitleStyle.larger")], [reset, i18n.t("subtitleStyle.resetPosition")]] as const) {
      button.setAttribute("aria-label", label)
      button.title = label
    }
    smaller.disabled = size.value <= size.min
    larger.disabled = size.value >= size.max
    reset.textContent = i18n.t("subtitleStyle.resetPosition")
    error.textContent = i18n.t("videoTranslationControls.saveFailed")
    error.hidden = !state.saveFailed
  }

  const placeInline = (node: HTMLElement, container: Element, before: Element | null) => {
    if (node.parentElement === container && node.nextElementSibling === before)
      return false
    container.insertBefore(node, before)
    return true
  }
  const moveHost = (container: Element, inline: boolean, before: Element | null) => {
    const focus = shadow.activeElement as HTMLElement | null
    if (inline) {
      if (placeInline(host, container, before))
        focus?.focus({ preventScroll: true })
    }
    else if (host.parentElement !== container) {
      container.append(host)
      focus?.focus({ preventScroll: true })
    }
    host.dataset.placement = inline ? "inline" : "portal"
  }

  // Read only the native control group and its player ancestors. The dock's
  // own opacity and portal must never become a visibility signal for itself.
  const nativeVisible = (group: Element, container: Element) => {
    for (let element: Element | null = group; element; element = element.parentElement) {
      const style = view.getComputedStyle(element)
      if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true"
        || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
        || style.opacity === "0" || (element as HTMLElement).style.opacity === "0") {
        return false
      }
      if (element === container)
        break
    }
    return true
  }
  let observedGroup: Element | null = null
  let observedContainer: Element | null = null
  const visibilityObserver = new view.MutationObserver(() => tick())
  const observeNative = (group: Element | null, container: Element) => {
    if (observedGroup === group && observedContainer === container)
      return
    observedGroup = group
    observedContainer = container
    visibilityObserver.disconnect()
    if (!group)
      return
    for (let element: Element | null = group; element; element = element.parentElement) {
      visibilityObserver.observe(element, { attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] })
      if (element === container)
        break
    }
  }

  function tick() {
    if (disposed)
      return
    const videoRect = video.getBoundingClientRect()
    const fullscreen = owner.fullscreenElement
    const videoStyle = view.getComputedStyle(video)
    const visible = video.isConnected && videoRect.width > 0 && videoRect.height > 0
      && videoRect.bottom > 0 && videoRect.right > 0 && videoRect.top < view.innerHeight && videoRect.left < view.innerWidth
      && videoStyle.display !== "none" && videoStyle.visibility !== "hidden" && videoStyle.visibility !== "collapse"
      && !video.closest("[aria-hidden='true']") && (!fullscreen || (fullscreen !== video && fullscreen.contains(video)))
    const youtubePlayer = video.closest<HTMLElement>(".html5-video-player")
    const xControls = youtubePlayer ? null : xVideoControls(video)
    const controls = youtubePlayer?.querySelector<HTMLElement>(".ytp-right-controls") ?? xControls
    const before = youtubePlayer ? Array.from(controls?.children ?? []).find(child => child !== host && child !== anchor) ?? null : xControls ? xVideoToolsStart(xControls) : null
    const playerRect = youtubePlayer?.getBoundingClientRect()
    const rect = playerRect && playerRect.width > 0 && playerRect.height > 0 ? playerRect : videoRect
    const chrome = youtubePlayer?.querySelector<HTMLElement>(".ytp-chrome-bottom")
    const chromeRect = chrome?.getBoundingClientRect()
    host.dataset.toolbar = xControls ? "x" : youtubePlayer ? "youtube" : "generic"
    host.toggleAttribute("data-narrow", rect.width < 420)
    // Measure native children rather than the group that also contains this host.
    // Removing the dock then leaves the same decision, so narrow players do not oscillate.
    const nativeWidth = (group: Element | null | undefined) => Array.from(group?.children ?? []).reduce((width, child) => {
      if (child === host || child === anchor)
        return width
      const childStyle = view.getComputedStyle(child)
      if (childStyle.display === "none" || childStyle.position === "absolute" || childStyle.position === "fixed")
        return width
      // Progress sliders fill the toolbar's remaining space and may shrink
      // when this small fixed-size entry is inserted.
      if (Number.parseFloat(childStyle.flexGrow) > 0 && Number.parseFloat(childStyle.flexShrink) !== 0)
        return width + (Number.parseFloat(childStyle.minWidth) || 0)
      // Flex auto margins are free space, even when CSSOM resolves them to
      // pixels. Counting that allocation would incorrectly hide this entry.
      const computedMargins = child.computedStyleMap?.()
      const margin = (property: "margin-left" | "margin-right") => computedMargins?.get(property)?.toString() === "auto" || (child as HTMLElement).style?.getPropertyValue(property) === "auto" ? 0 : Number.parseFloat(childStyle.getPropertyValue(property)) || 0
      return width + child.getBoundingClientRect().width + margin("margin-left") + margin("margin-right")
    }, 0)
    const leftControls = youtubePlayer?.querySelector(".ytp-left-controls")
    const rightControls = youtubePlayer?.querySelector(".ytp-right-controls")
    const groupPadding = (group: Element | null | undefined) => {
      if (!group)
        return 0
      const style = view.getComputedStyle(group)
      return (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
    }
    const occupiedWidth = (group: Element | null | undefined) => {
      const owned = host.parentElement === group ? host : anchor.parentElement === group ? anchor : null
      const ownedRect = owned?.getBoundingClientRect()
      const ownedWidth = ownedRect && ownedRect.width > 0 ? ownedRect.width + 8 : 0
      return Math.max(nativeWidth(group) + groupPadding(group), (group?.getBoundingClientRect().width ?? 0) - ownedWidth)
    }
    // YouTube's left group can flex across all space before the right tools.
    // Its empty allocation is available to this dock, not native occupancy.
    const nativeYouTubeWidth = nativeWidth(leftControls) + groupPadding(leftControls) + occupiedWidth(rightControls)
    const dockWidth = dock.getBoundingClientRect().width || (rect.width < 420 ? 68 : 80)
    const toolbarStyle = !youtubePlayer && controls ? view.getComputedStyle(controls) : null
    const rowPadding = toolbarStyle ? (Number.parseFloat(toolbarStyle.paddingLeft) || 0) + (Number.parseFloat(toolbarStyle.paddingRight) || 0) : 0
    const rowGap = toolbarStyle ? (Number.parseFloat(toolbarStyle.columnGap) || 0) * Array.from(controls!.children).filter(child => child !== host && child !== anchor && view.getComputedStyle(child).position !== "absolute").length + 8 : 16
    const controlsRect = controls?.getBoundingClientRect()
    const rowWidth = youtubePlayer ? chromeRect?.width ?? 0 : controlsRect?.width ?? 0
    const fitsInline = rowWidth - rowPadding >= (youtubePlayer ? nativeYouTubeWidth : nativeWidth(controls)) + dockWidth + rowGap
    const videoContainer = video.closest<HTMLElement>("[data-testid='videoComponent']") ?? xVideoContainer(video) ?? video
    const nativeControls = controls ?? chrome
    const nativeContainer = youtubePlayer ?? videoContainer
    observeNative(nativeControls ?? null, nativeContainer)
    const autoHidden = !!youtubePlayer?.classList.contains("ytp-autohide") || (!!nativeControls && !nativeVisible(nativeControls, nativeContainer))
    // Native opacity does not change this association. A hidden toolbar keeps
    // its slot, and a replacement toolbar can reclaim it on the next tick.
    const nativeSlot = !!controls?.isConnected
    const usableToolbar = nativeSlot && !!controlsRect && controlsRect.width > 0 && controlsRect.height > 0
      && controlsRect.bottom > rect.top && controlsRect.top < rect.bottom
    const show = visible && usableToolbar && fitsInline
    const portal = nativeSlot && menuOpen
    const inline = nativeSlot && !portal
    if (portal) {
      anchor.style.setProperty("width", `${dockWidth}px`, "important")
      anchor.style.setProperty("margin-right", "8px", "important")
      placeInline(anchor, controls!, before)
    }
    else {
      anchor.remove()
    }
    const container = inline ? controls! : fullscreen ?? owner.documentElement
    moveHost(container, inline, before)
    host.toggleAttribute("data-inline-anchor", nativeSlot)
    // Menus and focus follow the host player's visibility too. Keeping a
    // portal interactive here would detach it from the hidden playback bar.
    const idle = autoHidden
    host.toggleAttribute("data-hidden", !show)
    host.toggleAttribute("data-idle", idle)
    if (!show || idle)
      host.setAttribute("aria-hidden", "true")
    else
      host.removeAttribute("aria-hidden")
    host.toggleAttribute("inert", !show || idle)
    if (!show) {
      host.style.removeProperty("left")
      host.style.removeProperty("top")
      return
    }
    if (portal) {
      const anchorRect = anchor.getBoundingClientRect()
      const dockHeight = dock.getBoundingClientRect().height || 34
      // The portal only escapes native stacking contexts; its dock remains at
      // the native slot. It never derives a separate video-corner position.
      const top = (anchorRect.height > 0 ? anchorRect.top + anchorRect.height / 2 : controlsRect!.top + controlsRect!.height / 2) - dockHeight / 2
      const beforeRect = before?.getBoundingClientRect()
      const left = anchorRect.width > 0 ? anchorRect.left : beforeRect && beforeRect.width > 0 ? beforeRect.left - dockWidth - 8 : controlsRect!.left
      host.style.setProperty("left", `${left}px`, "important")
      host.style.setProperty("top", `${top}px`, "important")
    }
    else {
      host.style.removeProperty("left")
      host.style.removeProperty("top")
    }
    if (menuOpen) {
      const dockRect = dock.getBoundingClientRect()
      const width = Math.min(240, Math.max(0, rect.width - 24), view.innerWidth - 24)
      const left = dockRect.width > 0 ? dockRect.right - width : rect.right - width - 12
      const top = dockRect.height > 0 ? dockRect.top : rect.bottom - 52
      panel.style.width = `${width}px`
      panel.style.left = `${Math.max(Math.max(12, rect.left + 12), Math.min(left, rect.right - width - 12, view.innerWidth - width - 12))}px`
      panel.style.maxHeight = `${Math.max(48, top - Math.max(rect.top, 0) - 16)}px`
      const panelHeight = panel.getBoundingClientRect().height || 190
      panel.style.top = `${Math.max(rect.top + 8, top - panelHeight - 9)}px`
    }
  }

  const setMenu = (open: boolean, focusTrigger = false) => {
    menuOpen = open
    render()
    tick()
    if (focusTrigger)
      trigger.focus({ preventScroll: true })
  }
  toggle.addEventListener("click", () => {
    if (!state.excluded)
      options.onToggle(!state.enabled)
  })
  trigger.addEventListener("click", () => setMenu(!menuOpen))
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setMenu(true)
      presetButtons[SUBTITLE_PRESETS.indexOf(state.appearance.preset)].focus({ preventScroll: true })
    }
  })
  presets.addEventListener("keydown", (event) => {
    const index = presetButtons.indexOf(shadow.activeElement as HTMLButtonElement)
    if (index < 0 || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
      return
    event.preventDefault()
    const offset = event.key === "ArrowUp" ? -2 : event.key === "ArrowDown" ? 2 : event.key === "ArrowLeft" ? -1 : 1
    const next = event.key === "Home" ? 0 : event.key === "End" ? presetButtons.length - 1 : (index + offset + presetButtons.length) % presetButtons.length
    presetButtons[next].focus({ preventScroll: true })
    presetButtons[next].click()
  })
  const changeSize = (direction: number) => {
    const size = subtitleSizeSettings(state.appearance)
    options.onStyleChange(subtitleSizePatch(state.appearance, Math.max(size.min, Math.min(size.max, size.value + direction * size.step))))
  }
  smaller.addEventListener("click", () => changeSize(-1))
  larger.addEventListener("click", () => changeSize(1))
  reset.addEventListener("click", () => options.onStyleChange({ position: SUBTITLE_POSITIONS.bottom }))
  const onOutsidePointer = (event: Event) => {
    if (menuOpen && !event.composedPath().includes(host))
      setMenu(false)
  }
  const onEscape = (event: KeyboardEvent) => {
    if (menuOpen && !host.hasAttribute("inert") && event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setMenu(false, true)
    }
  }
  // Keep clicks and keyboard gestures in these controls from toggling the host video.
  for (const type of ["click", "mousedown", "pointerdown", "dblclick", "keydown", "keyup"])
    host.addEventListener(type, event => event.stopPropagation())
  host.addEventListener("focusin", tick)
  host.addEventListener("focusout", () => queueMicrotask(tick))
  owner.addEventListener("pointerdown", onOutsidePointer, true)
  owner.addEventListener("keydown", onEscape, true)
  owner.addEventListener("fullscreenchange", tick)
  view.addEventListener("resize", tick)
  view.addEventListener("scroll", tick, true)
  const resize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(tick) : null
  resize?.observe(video)
  const youtubePlayer = video.closest(".html5-video-player")
  if (youtubePlayer)
    resize?.observe(youtubePlayer)
  render()
  tick()

  const controller: VideoTranslationControls = {
    update: (next) => {
      if (disposed)
        return
      state = { ...state, ...next }
      if (next.saveFailed)
        menuOpen = true
      render()
      tick()
    },
    tick,
    // Supported players already provide the native toolbar's caption inset.
    dispose: () => {
      if (disposed)
        return
      disposed = true
      resize?.disconnect()
      visibilityObserver.disconnect()
      owner.removeEventListener("pointerdown", onOutsidePointer, true)
      owner.removeEventListener("keydown", onEscape, true)
      owner.removeEventListener("fullscreenchange", tick)
      view.removeEventListener("resize", tick)
      view.removeEventListener("scroll", tick, true)
      host.remove()
      anchor.remove()
      if (mountedControls.get(video) === controller)
        mountedControls.delete(video)
    },
  }
  mountedControls.set(video, controller)
  return controller
}
