/** Subtitle preferences are shared by every page on this exact hostname. */
export function subtitleSiteKey(value: string): string {
  const url = new URL(value)
  return url.hostname || url.origin
}
