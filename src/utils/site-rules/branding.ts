import type { SiteRule } from "@/types/config/site-rules"
import upstreamRules from "./built-in/rules.json"

const legacyBuiltInIds = new Set(upstreamRules.map(rule => rule.id).filter(id => id.startsWith("readfrog-")))

/** Canonical public ID; unknown IDs are kept so existing configuration is not discarded. */
export function normalizeBuiltInSiteRuleId(id: string): string {
  return legacyBuiltInIds.has(id) ? id.replace(/^readfrog-/, "readomi-") : id
}

/** Used by both execution and the options toggles, including re-enabling legacy IDs. */
export function normalizeDisabledBuiltInRuleIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(normalizeBuiltInSiteRuleId))]
}

const brandedRules = new WeakMap<SiteRule, SiteRule>()

/**
 * Public Readomi rule data: names, DOM selectors, attributes and CSS agree with
 * what the extension executes and copies. The upstream snapshot stays intact.
 * Rule objects are immutable; cache only their branding conversion.
 */
export function toReadomiSiteRule(rule: SiteRule): SiteRule {
  const cached = brandedRules.get(rule)
  if (cached)
    return cached

  let changed = false
  const entries = Object.entries(rule).map(([key, value]) => {
    if (key === "id") {
      const id = normalizeBuiltInSiteRuleId(rule.id)
      changed ||= id !== value
      return [key, id]
    }
    if (key === "description" && typeof value === "string") {
      const description = value.replaceAll("Read Frog", "Readomi")
      changed ||= description !== value
      return [key, description]
    }
    if (key.toLowerCase().includes("selectors") || key.startsWith("injectedCss")) {
      const adapt = (text: unknown) => {
        if (typeof text !== "string")
          return text
        const branded = text.replaceAll("read-frog-", "readomi-")
        changed ||= branded !== text
        return branded
      }
      return [key, Array.isArray(value) ? value.map(adapt) : adapt(value)]
    }
    return [key, value]
  })
  const branded = changed ? Object.fromEntries(entries) as SiteRule : rule
  brandedRules.set(rule, branded)
  return branded
}
