import type { VideoSiteRule } from "@/types/config/video-site-rules"
import { normalizeUrlPattern, urlMatchesPattern } from "@/utils/site-rules/url-pattern"

function compileRegex(value: string): RegExp | null {
  try {
    return new RegExp(value, "i")
  }
  catch {
    return null
  }
}

/** Domain rules accept hostnames only; ports, protocols and paths belong in URL patterns. */
function normalizeDomain(value: string): string | null {
  const raw = value.trim()
  if (!raw || /[\s/?#@\\%*]/.test(raw))
    return null
  // URL erases a default :80 port. Reject every suffix of a bracketed IPv6
  // literal before parsing so a domain rule cannot silently discard a port.
  if (raw.startsWith("[") && !raw.endsWith("]"))
    return null

  try {
    // A bare IPv6 address is convenient to paste; URL supplies its canonical form.
    const host = raw.includes(":") && !raw.startsWith("[") ? `[${raw}]` : raw
    const parsed = new URL(`http://${host}`)
    if (parsed.port || parsed.username || parsed.password || parsed.pathname !== "/")
      return null
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
    if (hostname.startsWith("["))
      return hostname
    if (hostname.length > 253 || !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
      return null
    return hostname
  }
  catch {
    return null
  }
}

function normalizeVideoUrlPattern(value: string): string | null {
  const normalized = normalizeUrlPattern(value)
  const match = normalized?.match(/^([^:]+):\/\/([^/]+)(\/.*)$/)
  if (!match || /[\s?#\\]/.test(match[3]!))
    return null
  let host = match[2]!
  if (host !== "*") {
    if (host.includes("*")) {
      // Encode complete IDN labels while retaining the existing ASCII wildcard
      // semantics. A wildcard inside an international label is ambiguous.
      const labels = host.split(".").map((label) => {
        if (label.includes("*"))
          return /^[a-z0-9*-]+$/i.test(label) ? label : null
        return normalizeDomain(`${label}.invalid`)?.slice(0, -".invalid".length) ?? null
      })
      if (labels.includes(null))
        return null
      host = labels.join(".")
      if (!normalizeDomain(host.replaceAll("*", "a")))
        return null
    }
    else {
      const domain = normalizeDomain(host)
      if (!domain)
        return null
      host = domain
    }
  }
  return `${match[1]}://${host}${match[3]}`
}

/** Canonical stored form, or null when the rule cannot be safely interpreted. */
export function normalizeVideoSiteRule(rule: VideoSiteRule): VideoSiteRule | null {
  let value: string | null = rule.value.trim()
  if (!value)
    return null
  switch (rule.type) {
    case "domain":
      value = normalizeDomain(value)
      break
    case "pattern":
      value = normalizeVideoUrlPattern(value)
      break
    case "regex":
      if (!compileRegex(value))
        return null
      break
    default:
      return null
  }
  return value ? { type: rule.type, value } : null
}

/** A popup exclusion applies to the visible host, never an inferred parent domain. */
export function videoDomainRuleForUrl(url: string): VideoSiteRule | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null
    return normalizeVideoSiteRule({ type: "domain", value: parsed.hostname })
  }
  catch {
    return null
  }
}

/**
 * Domain rules include the apex and its subdomains. URL patterns use the same
 * host/path semantics as site rules (ports, query and hash are ignored).
 * Regular expressions match the complete URL, including its query and hash,
 * without case sensitivity. Invalid rules never block video translation.
 */
export function isVideoTranslationExcluded(url: string, rules: readonly VideoSiteRule[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return false
  }
  catch {
    return false
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
  parsed.hostname = hostname
  return rules.some((candidate) => {
    const rule = normalizeVideoSiteRule(candidate)
    if (!rule)
      return false
    switch (rule.type) {
      case "domain":
        if (hostname === rule.value)
          return true
        // IP literals identify one host and cannot have subdomains.
        return !rule.value.startsWith("[") && !/^\d+(?:\.\d+){3}$/.test(rule.value) && hostname.endsWith(`.${rule.value}`)
      case "pattern":
        return urlMatchesPattern(parsed.href, rule.value)
      case "regex":
        return compileRegex(rule.value)?.test(url) ?? false
    }
    return false
  })
}
