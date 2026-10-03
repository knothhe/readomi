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

function controlsGroup(container: HTMLElement): HTMLElement | null {
  const explicit = container.querySelector<HTMLElement>("[data-testid='videoControls']")
  const icon = container.querySelector("button[role='button'] > div > svg")
  return explicit ?? icon?.parentElement?.parentElement?.parentElement?.parentElement ?? null
}

/** X reveals controls on interaction or pause. Read Frog reserves at most 25%. */
export function xCaptionBottom(video: HTMLVideoElement, rect: { height: number }, captionInteracting = false): number | undefined {
  const container = video.closest<HTMLElement>("[data-testid='videoComponent']") ?? xVideoContainer(video)
  if (!container || rect.height <= 0)
    return undefined
  const controls = controlsGroup(container)
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
