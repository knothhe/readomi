/** YouTube time, chapter and playlist parameters do not create a new video page. */
export function subtitlePageKey(value: string): string {
  const url = new URL(value)
  if (/(?:^|\.)youtube(?:-nocookie)?\.com$/.test(url.hostname)) {
    const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]
    if (id)
      return `${url.origin}/video/${id}`
  }
  return `${url.origin}${url.pathname}${url.search}`
}
