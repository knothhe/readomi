import { logger } from "@/utils/logger"

/** Normalize Read Frog's hostname/path shorthand and browser match patterns. */
export function normalizeUrlPattern(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed)
    return null

  let scheme = "*"
  let rest = trimmed
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*|\*):\/\//i)
  if (schemeMatch) {
    scheme = schemeMatch[1]!.toLowerCase()
    rest = trimmed.slice(schemeMatch[0].length)
  }
  if (scheme !== "*" && scheme !== "http" && scheme !== "https")
    return null

  const slashIndex = rest.indexOf("/")
  const host = (slashIndex === -1 ? rest : rest.slice(0, slashIndex)).toLowerCase()
  const path = slashIndex === -1 ? "/*" : rest.slice(slashIndex)
  if (!host || /[\s?#@\\]/.test(host))
    return null
  if (host.includes(":")) {
    if (!host.startsWith("[") || !host.endsWith("]"))
      return null
    try {
      if (new URL(`http://${host}`).hostname !== host)
        return null
    }
    catch {
      return null
    }
  }
  return `${scheme}://${host}${path}`
}

interface CompiledPattern {
  scheme: string
  host: RegExp
  path: RegExp
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const patternCache = new Map<string, CompiledPattern | null>()
const MAX_PATTERN_CACHE = 2048

function compilePattern(raw: string): CompiledPattern | null {
  if (patternCache.has(raw))
    return patternCache.get(raw) ?? null

  const normalized = normalizeUrlPattern(raw)
  const match = normalized?.match(/^([a-z*]+):\/\/([^/]+)(\/.*)$/)
  let compiled: CompiledPattern | null = null
  if (match) {
    // A leading *. includes the apex; mid-host and TLD wildcards retain the
    // original built-in data semantics. '*' also covers bracketed IPv6 hosts.
    let hostSource = match[2] === "*" ? ".*" : escapeForRegex(match[2]!).replaceAll("\\*", "[a-z0-9.-]*")
    if (hostSource.startsWith("[a-z0-9.-]*\\.")) {
      hostSource = `(?:[^.]+\\.)*${hostSource.slice("[a-z0-9.-]*\\.".length)}`
    }
    compiled = {
      scheme: match[1]!,
      host: new RegExp(`^${hostSource}$`, "i"),
      path: new RegExp(`^${escapeForRegex(match[3]!).replaceAll("\\*", ".*")}$`),
    }
  }
  else {
    logger.warn(`[site-rules] Unsupported URL pattern dropped: "${raw}"`)
  }
  if (patternCache.size >= MAX_PATTERN_CACHE)
    patternCache.clear()
  patternCache.set(raw, compiled)
  return compiled
}

/** Exact bare hosts; *.host includes subdomains; query/hash and ports ignored. */
export function urlMatchesPattern(url: string, rawPattern: string): boolean {
  const pattern = compilePattern(rawPattern)
  if (!pattern)
    return false

  try {
    const parsed = new URL(url)
    const scheme = parsed.protocol.slice(0, -1)
    if (pattern.scheme === "*" ? scheme !== "http" && scheme !== "https" : scheme !== pattern.scheme)
      return false
    return pattern.host.test(parsed.hostname) && pattern.path.test(parsed.pathname)
  }
  catch {
    return false
  }
}
