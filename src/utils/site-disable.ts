import type { Config } from "@/types/config/config"

/** Website switches apply to one hostname, across protocols, ports and paths. */
export function siteHostname(url: string): string | null {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase().replace(/\.$/, "") || null : null
  }
  catch {
    return null
  }
}

export function isSiteDisabled(url: string, config: Config | null): boolean {
  const hostname = siteHostname(url)
  return !!hostname && !!config?.features.disabledSites.some(value => siteHostname(`https://${value}`) === hostname)
}
