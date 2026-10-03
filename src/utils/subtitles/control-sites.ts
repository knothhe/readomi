const YOUTUBE_HOSTS = ["youtube.com", "youtube-nocookie.com"]
const X_HOSTS = ["x.com", "twitter.com"]

function matchesHost(hostname: string, domains: readonly string[]): boolean {
  return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

/** The toolbar follows Read Frog's supported sites, independently of HTML5 captions. */
export function shouldShowVideoControls(video: HTMLVideoElement, href = location.href): boolean {
  let url: URL
  try {
    url = new URL(href)
  }
  catch {
    return false
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return false
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  if (matchesHost(hostname, X_HOSTS))
    return !!video.closest("article")
  if (!matchesHost(hostname, YOUTUBE_HOSTS))
    return false

  const player = video.closest(".html5-video-player")
  if (!player)
    return false
  const document = video.ownerDocument
  if ((url.pathname === "/watch" && url.searchParams.get("v")) || /^\/live\/[^/]+(?:\/|$)/.test(url.pathname))
    return !!document.querySelector("#movie_player")?.contains(video)
  if (/^\/embed\/[^/]+(?:\/|$)/.test(url.pathname)) {
    const main = document.querySelector("#movie_player")
    return !main || main.contains(video)
  }
  if (/^\/shorts\/[^/]+(?:\/|$)/.test(url.pathname)) {
    const active = document.querySelector("#reel-overlay-container .html5-video-player")
    return !active || active === player
  }
  return false
}
