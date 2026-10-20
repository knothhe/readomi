/** Playback navigation within one video or X post keeps the page's switch. */
export function subtitlePageKey(value: string): string {
  const url = new URL(value)
  if (/(?:^|\.)youtube(?:-nocookie)?\.com$/.test(url.hostname)) {
    const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]
    if (id)
      return `${url.origin}/video/${id}`
  }
  if (/(?:^|\.)(?:x|twitter)\.com$/.test(url.hostname)) {
    const id = url.pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/(?:video|photo)\/\d+)?\/?$/)?.[1]
    if (id)
      return `${url.origin}/status/${id}`
  }
  return `${url.origin}${url.pathname}${url.search}`
}

/** Subtitle preferences are shared by every page on this exact hostname. */
export function subtitleSiteKey(value: string): string {
  const url = new URL(value)
  return url.hostname || url.origin
}
