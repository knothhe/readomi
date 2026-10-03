import type { SiteRulesContext } from "../effective"
// @vitest-environment jsdom
import type { SiteRule } from "@/types/config/site-rules"
import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { siteRulesConfigSchema } from "@/types/config/site-rules"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { normalizeDisabledBuiltInRuleIds } from "../branding"
import { getEffectiveSiteRule } from "../effective"

function context(userRules: SiteRule[] = [], disabledBuiltInRules: string[] = []): SiteRulesContext {
  return { siteRules: { userRules, disabledBuiltInRules } }
}

describe("effective site rules", () => {
  it("upgrades configs without siteRules and retains global defaults", () => {
    expect(siteRulesConfigSchema.parse(undefined)).toEqual({ userRules: [], disabledBuiltInRules: [] })
    expect(getEffectiveSiteRule({}, "https://example.com").atomSelector).toContain("span.katex")
  })

  it("memoizes per config identity and URL", () => {
    const config = context([{ id: "user", matches: "example.com", excludeSelectors: ["nav"] }])
    const first = getEffectiveSiteRule(config, "https://example.com/a")
    expect(getEffectiveSiteRule(config, "https://example.com/a")).toBe(first)
    expect(getEffectiveSiteRule(config, "https://other.com/a").excludeSelector).toBeNull()
    expect(getEffectiveSiteRule(context(), "https://example.com/a")).not.toBe(first)
  })

  it("invalidates when siteRules or its arrays are replaced", () => {
    const config = context()
    const first = getEffectiveSiteRule(config, "https://example.com")
    config.siteRules!.userRules = [{ id: "user", matches: "example.com", excludeSelectors: ["nav"] }]
    expect(getEffectiveSiteRule(config, "https://example.com").excludeSelector).toBe("nav")
    config.siteRules = { userRules: [], disabledBuiltInRules: [] }
    expect(getEffectiveSiteRule(config, "https://example.com").excludeSelector).toBeNull()
    expect(getEffectiveSiteRule(config, "https://example.com")).not.toBe(first)
  })

  it("keeps Readomi's X block style only while the upstream twitter rule is enabled", () => {
    const url = "https://x.com/example/status/123"
    const enabled = getEffectiveSiteRule(context(), url)
    expect(enabled.forceBlockNodeSelector).toContain("[data-testid=\"tweetText\"]")
    expect(enabled.forceBlockStyleSelector).toContain("[data-testid=\"tweetText\"]")
    expect(enabled.forceInlineStyleSelector).toContain("[data-testid=\"tweetText\"] span")
    const disabled = getEffectiveSiteRule(context([], ["twitter"]), url)
    expect(disabled.matchedRuleIds).not.toContain("twitter")
    expect(disabled.matchedRuleIds).not.toContain("readomi-twitter-quote")
    expect(disabled.forceBlockStyleSelector).toBeNull()
    const settings = getEffectiveSiteRule(context(), "https://x.com/settings/account")
    expect(settings.forceBlockStyleSelector).toBeNull()
  })

  it("lets user removals override compatibility rules too", () => {
    const resolved = getEffectiveSiteRule(context([{
      "id": "user", "matches": "x.com", "forceBlockStyleSelectors.remove": ["[data-testid=\"tweetText\"]"],
    }]), "https://x.com/home")
    expect(resolved.forceBlockStyleSelector?.split(",")).not.toContain("[data-testid=\"tweetText\"]")
  })

  it("keeps all legacy GitHub and Engoo adaptations configurable", () => {
    const github = getEffectiveSiteRule(context(), "https://github.com/example/repo")
    expect(github.excludeSelector).toContain("table.diff-table")
    expect(github.forceBlockNodeSelector).toContain("task-lists")
    const disabled = getEffectiveSiteRule(context([], ["readfrog-github"]), "https://github.com/example/repo")
    expect(disabled.excludeSelector).not.toContain("table.diff-table")
    const engoo = getEffectiveSiteRule(context(), "https://engoo.com/lesson")
    expect(engoo.forceBlockStyleSelector).toContain("#windowexercise-2")
    expect(getEffectiveSiteRule(context([], ["autoHeight"]), "https://engoo.com/lesson").forceBlockStyleSelector).toBeNull()
  })

  it("reads legacy disabled rule IDs without resetting stored config and re-enables canonical IDs", () => {
    const legacy = configSchema.parse({
      ...DEFAULT_CONFIG,
      siteRules: { userRules: [], disabledBuiltInRules: ["readfrog-github", "readfrog-youtube"] },
    })
    const disabled = getEffectiveSiteRule(legacy, "https://github.com/example/repo")
    expect(disabled.matchedRuleIds).not.toContain("readomi-github")
    expect(disabled.excludeSelector).not.toContain("table.diff-table")
    expect(disabled.forceBlockNodeSelector).not.toContain("task-lists")

    const toggled = new Set(normalizeDisabledBuiltInRuleIds(legacy.siteRules.disabledBuiltInRules))
    toggled.delete("readomi-github")
    const enabled = getEffectiveSiteRule({ ...legacy, siteRules: { ...legacy.siteRules, disabledBuiltInRules: [...toggled] } }, "https://github.com/example/repo")
    expect(enabled.matchedRuleIds).toContain("readomi-github")
    expect(enabled.excludeSelector).toContain("table.diff-table")
    expect(enabled.forceBlockNodeSelector).toContain("task-lists")
    expect([...toggled]).toEqual(["readomi-youtube"])
    expect(legacy.siteRules.disabledBuiltInRules).toEqual(["readfrog-github", "readfrog-youtube"])
  })
})
