const X_VIDEO_CONTAINER_SELECTOR = "[data-testid='videoPlayer'],[data-testid='videoComponent'],[data-testid='videoPlayerContainer']"

export function isXHost(hostname = location.hostname): boolean {
  return ["x.com", "twitter.com"].some(host => hostname === host || hostname.endsWith(`.${host}`))
}

export function xStatusId(href: string): string | null {
  try {
    const url = new URL(href, location.href)
    return isXHost(url.hostname) ? url.pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/)?.[1] ?? null : null
  }
  catch {
    return null
  }
}

export function xVideoContainer(video: HTMLVideoElement): HTMLElement | null {
  return video.closest<HTMLElement>(X_VIDEO_CONTAINER_SELECTOR) ?? video.parentElement
}

/** Match Read Frog's X target priority without mounting subtitles on every reply. */
export function currentXVideo(): HTMLVideoElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLVideoElement>("article video")).filter((video) => {
    const rect = video.getBoundingClientRect()
    return video.isConnected && !video.closest("[aria-hidden='true']") && rect.width > 0 && rect.height > 0
  })
  const fullscreen = document.fullscreenElement
  const focused = document.activeElement
  const interacting = candidates.find((video) => {
    const container = video.closest<HTMLElement>("[data-testid='videoComponent']") ?? xVideoContainer(video)
    return container?.matches(":hover") || (focused && focused !== document.body && container?.contains(focused))
  })
  const statusId = xStatusId(location.href)
  const marked = candidates.find(video => video.dataset.readomiXSubtitlePage === location.pathname)
  const preferred = statusId ? candidates.filter(video => Array.from(video.closest("article")!.querySelectorAll<HTMLAnchorElement>("a[href]")).some(anchor => xStatusId(anchor.href) === statusId)) : []
  return candidates.find(video => fullscreen === video || fullscreen?.contains(video))
    ?? interacting
    ?? (marked && (statusId || !marked.paused || !candidates.some(video => !video.paused)) ? marked : null)
    ?? (preferred.length === 1 ? preferred[0] : null)
    ?? candidates.find(video => !video.paused)
    ?? (candidates.length === 1 ? candidates[0] : null)
    ?? null
}

/** The article identifies a reply or quote even while the URL names the main post. */
export function xVideoIdentity(video: HTMLVideoElement): string {
  const article = video.closest("article")
  const timeLink = article?.querySelector("a[href] time")?.closest<HTMLAnchorElement>("a[href]")
  const own = timeLink ? xStatusId(timeLink.href) : null
  const linked = Array.from(article?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []).map(anchor => xStatusId(anchor.href)).find(Boolean)
  return own ?? linked ?? xStatusId(location.href) ?? location.pathname
}

const READOMI_CONTROLS_SELECTOR = "[data-readomi-video-controls],[data-readomi-controls-anchor]"

function nativeButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("button,[role='button']")).filter(button => !button.closest(READOMI_CONTROLS_SELECTOR))
}

function controlsGroup(container: HTMLElement, video: HTMLVideoElement): HTMLElement | null {
  const explicit = container.querySelector<HTMLElement>("[data-testid='videoControls']")
  if (explicit)
    return explicit
  const videoRect = video.getBoundingClientRect()
  const view = video.ownerDocument.defaultView
  if (!view || videoRect.width <= 0 || videoRect.height <= 0)
    return null
  // Ads put their More button before playback controls, and idle players can
  // leave just a floating mute button. Neither identifies a playback row.
  const checked = new Set<HTMLElement>()
  for (const button of nativeButtons(container)) {
    if (!button.querySelector("svg") || button.getAttribute("aria-haspopup") === "menu")
      continue
    for (let group = button.parentElement; group && group !== container; group = group.parentElement) {
      if (checked.has(group) || group.contains(video))
        continue
      checked.add(group)
      const style = view.getComputedStyle(group)
      if (!["flex", "inline-flex"].includes(style.display) || !["row", "row-reverse", ""].includes(style.flexDirection))
        continue
      const rect = group.getBoundingClientRect()
      if (rect.width < videoRect.width * 0.75 || rect.height <= 0 || rect.height > Math.max(48, videoRect.height * 0.35)
        || rect.top < videoRect.top + videoRect.height / 2 || Math.abs(rect.bottom - videoRect.bottom) > 24) {
        continue
      }
      if (nativeButtons(group).filter(native => native.getAttribute("aria-haspopup") !== "menu").length >= 2)
        return group
    }
  }
  return null
}

/** The page's control group supplies its own visibility and idle timing. */
export function xVideoControls(video: HTMLVideoElement): HTMLElement | null {
  const container = video.closest<HTMLElement>("[data-testid='videoComponent']") ?? xVideoContainer(video)
  return container && container !== video.ownerDocument.body && container !== video.ownerDocument.documentElement ? controlsGroup(container, video) : null
}

/** X has no stable right-group class. Its last native button is the right edge. */
export function xVideoToolsStart(controls: HTMLElement): HTMLElement | null {
  const buttons = nativeButtons(controls)
  if (buttons.length < 2)
    return null
  let before: HTMLElement | null = buttons.at(-1)!
  while (before && before.parentElement !== controls)
    before = before.parentElement
  return before
}

/** X reveals controls on interaction or pause. Read Frog reserves at most 25%. */
export function xCaptionBottom(video: HTMLVideoElement, rect: { height: number }, captionInteracting = false): number | undefined {
  const container = video.closest<HTMLElement>("[data-testid='videoComponent']") ?? xVideoContainer(video)
  if (!container || rect.height <= 0)
    return undefined
  const controls = controlsGroup(container, video)
  if (!controls)
    return rect.height * 0.98
  let visible = container.matches(":hover, :focus-within") || video.paused || captionInteracting
  if (controls) {
    for (let element: HTMLElement | null = controls; element && container.contains(element); element = element.parentElement) {
      const style = getComputedStyle(element)
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") {
        visible = false
        break
      }
      if (element === container)
        break
    }
  }
  const measured = controls?.getBoundingClientRect().height ?? 0
  const height = measured > 0 && measured < rect.height ? measured : 60
  return rect.height * 0.98 - (visible ? Math.min(height, rect.height * 0.25) : 0)
}
