import type { ResolvedSiteRule } from "./resolve"
import type { SiteRulesConfig } from "@/types/config/site-rules"
import { normalizeDisabledBuiltInRuleIds } from "./branding"
import { BUILT_IN_SITE_RULES, READOMI_RULE_DEPENDENCIES, READOMI_SITE_RULES } from "./built-in"
import { resolveSiteRule } from "./resolve"

/** Also accepts configs stored before the optional siteRules field existed. */
export interface SiteRulesContext {
  siteRules?: SiteRulesConfig
}

interface CachedResolution {
  url: string
  siteRules: SiteRulesConfig | undefined
  userRules: SiteRulesConfig["userRules"] | undefined
  disabledBuiltInRules: SiteRulesConfig["disabledBuiltInRules"] | undefined
  rule: ResolvedSiteRule
}

const cache = new WeakMap<SiteRulesContext, CachedResolution>()

/**
 * One resolution per configuration and page URL; hot DOM walks share it.
 * A fresh config, replaced rule arrays, or an SPA navigation invalidates it.
 * Treat rule objects and arrays as immutable when updating config.
 */
export function getEffectiveSiteRule(config: SiteRulesContext, url: string): ResolvedSiteRule {
  const cached = cache.get(config)
  const siteRules = config.siteRules
  const userRules = siteRules?.userRules
  const disabledBuiltInRules = siteRules?.disabledBuiltInRules
  if (cached?.url === url
    && cached.siteRules === siteRules
    && cached.userRules === userRules
    && cached.disabledBuiltInRules === disabledBuiltInRules) {
    return cached.rule
  }

  const disabled = new Set(normalizeDisabledBuiltInRuleIds(disabledBuiltInRules ?? []))
  const compatibilityRules = READOMI_SITE_RULES.filter(rule => !disabled.has(READOMI_RULE_DEPENDENCIES[rule.id]!))
  const rule = resolveSiteRule(url, [...BUILT_IN_SITE_RULES, ...compatibilityRules], userRules ?? [], disabledBuiltInRules ?? [])
  cache.set(config, { url, siteRules, userRules, disabledBuiltInRules, rule })
  return rule
}
