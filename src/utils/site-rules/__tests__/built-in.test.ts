// @vitest-environment jsdom
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { siteRuleSchema } from "@/types/config/site-rules"
import { toReadomiSiteRule } from "../branding"
import { BUILT_IN_SITE_RULES, READOMI_SITE_RULES } from "../built-in"
import rawRules from "../built-in/rules.json"
import rawRulesText from "../built-in/rules.json?raw"
import { resolveSiteRule } from "../resolve"
import { normalizeUrlPattern } from "../url-pattern"

describe("imported Read Frog site rules", () => {
  it("keeps all 484 original rules byte-for-byte", () => {
    expect(createHash("sha256").update(rawRulesText).digest("hex")).toBe("f58ffd26cb0a3094f95028aca66fef97a099e16bf4c0eef9d797533dd99aeac0")
    expect(BUILT_IN_SITE_RULES).toHaveLength(484)
    expect(BUILT_IN_SITE_RULES.filter(rule => rule.matches === "*")).toHaveLength(2)
    expect(new Set(BUILT_IN_SITE_RULES.map(rule => rule.id)).size).toBe(484)
  })

  it("preserves every imported field through the complete schema", () => {
    for (const rule of rawRules) {
      expect(siteRuleSchema.parse(rule)).toEqual(rule)
    }
    for (const rule of READOMI_SITE_RULES) {
      expect(siteRuleSchema.parse(rule)).toEqual(rule)
    }
  })

  it("exports all rules in source order with Readomi IDs, descriptions and DOM names", () => {
    expect(BUILT_IN_SITE_RULES).toEqual(rawRules.map(toReadomiSiteRule))
    expect(BUILT_IN_SITE_RULES.map(rule => rule.matches)).toEqual(rawRules.map(rule => rule.matches))
    expect(JSON.stringify(BUILT_IN_SITE_RULES)).not.toMatch(/readfrog-|read-frog-|Read Frog/)
    expect(BUILT_IN_SITE_RULES.find(rule => rule.id === "readomi-youtube")?.description).toBe("Skip YouTube chrome, metadata, and Readomi subtitle UI")
    for (const rule of BUILT_IN_SITE_RULES) expect(siteRuleSchema.parse(rule)).toEqual(rule)
  })

  it("copied public JSON executes as a custom rule after disabling the built-in", () => {
    const source = BUILT_IN_SITE_RULES.find(rule => rule.id === "vercel")!
    const copied = JSON.parse(JSON.stringify(source))
    const resolved = resolveSiteRule("https://vercel.com/docs", BUILT_IN_SITE_RULES, [copied], [source.id])
    expect(resolved.injectedCss).toContain("[data-docs-heading] .readomi-translated-content-wrapper")
    expect(resolved.injectedCss).not.toContain("read-frog-")
  })

  it("accepts every imported pattern and selector", () => {
    const probe = document.createDocumentFragment()
    for (const rule of [...BUILT_IN_SITE_RULES, ...READOMI_SITE_RULES]) {
      const patterns = [...(Array.isArray(rule.matches) ? rule.matches : [rule.matches]), ...(rule.excludeMatches ?? [])]
      for (const pattern of patterns) expect(normalizeUrlPattern(pattern), `${rule.id}: ${pattern}`).not.toBeNull()
      for (const [key, value] of Object.entries(rule)) {
        if (key.toLowerCase().includes("selectors") && Array.isArray(value)) {
          for (const selector of value) {
            if (typeof selector !== "string")
              throw new Error(`${rule.id}: ${key} contains a non-string selector`)
            expect(() => probe.querySelector(selector), `${rule.id}: ${selector}`).not.toThrow()
          }
        }
      }
      for (const group of rule.translationGroups ?? []) {
        for (const selector of [group.containerSelector, ...group.sourceSelectors])
          expect(() => probe.querySelector(selector), `${rule.id}: ${selector}`).not.toThrow()
      }
    }
  })

  it("adapts generated Read Frog DOM selectors and CSS without mutating data", () => {
    const resolved = resolveSiteRule("https://vercel.com/docs", BUILT_IN_SITE_RULES, [], [])
    expect(resolved.injectedCss).toContain("[data-docs-heading] .readomi-translated-content-wrapper")
    expect(resolved.injectedCss).not.toContain("read-frog-")
    const youtube = resolveSiteRule("https://www.youtube.com/watch?v=example", BUILT_IN_SITE_RULES, [], [])
    expect(youtube.excludeSelector).toContain(".readomi-subtitles-view")
    expect(rawRules.find(rule => rule.id === "readfrog-youtube")!.excludeSelectors).toContain(".read-frog-subtitles-view")
  })

  it("keeps every built-in CSS fragment after product class adaptation", () => {
    for (const rule of BUILT_IN_SITE_RULES) {
      const resolved = resolveSiteRule("https://example.com/", [{ ...rule, matches: "example.com", excludeMatches: [] }], [], [])
      const expected = [rule.injectedCss, ...(rule["injectedCss.add"] ?? [])]
        .filter((css): css is string => !!css?.trim())
        .map(css => css.replaceAll("read-frog-", "readomi-"))
      expect(resolved.injectedCss, rule.id).toBe(expected.length ? expected.join("\n") : null)
      expect(JSON.stringify(resolved), rule.id).not.toContain("read-frog-")
    }
  })

  it("adapts product attributes and all selector delta channels too", () => {
    const resolved = resolveSiteRule("https://example.com/", [{
      "id": "example", "matches": "example.com",
      "excludeSelectors": ["[data-read-frog-walked]"],
      "excludeSelectors.remove": ["[data-read-frog-walked]"],
      "includeSelectors.add": [".read-frog-translated-content-wrapper"],
      "injectedCss.add": ["[data-read-frog-block-node] { display: block; }"],
    }], [], [])
    expect(resolved.excludeSelector).toBeNull()
    expect(resolved.includeSelector).toBe(".readomi-translated-content-wrapper")
    expect(resolved.injectedCss).toBe("[data-readomi-block-node] { display: block; }")
  })

  it("retains scoped content roots, node/style separation and source text", () => {
    const x = resolveSiteRule("https://x.com/example/status/123", BUILT_IN_SITE_RULES, [], [])
    expect(x.includeSelector).toContain("[data-testid='tweetText']")
    expect(x.excludeSelector).toContain("[data-testid=User-Name]")
    expect(x.preserveTextSelector).toContain("[data-testid=\"tweetText\"] a")
    expect(x.forceInlineStyleSelector).toContain("[data-testid=\"tweetText\"] span")
    expect(x.forceInlineNodeSelector).toBeNull()
    expect(x.injectedCss).toContain("-webkit-line-clamp: unset!important")

    const chat = resolveSiteRule("https://chat.x.com/thread", BUILT_IN_SITE_RULES, [], [])
    expect(chat.includeSelector).toBeNull()
    expect(chat.matchedRuleIds).not.toContain("twitter")

    const alibaba = resolveSiteRule("https://sourcing.alibaba.com/rfq_detail.htm?example", BUILT_IN_SITE_RULES, [], [])
    expect(alibaba.dontWalkTags?.has("PRE")).toBe(false)
    expect(alibaba.dontWalkTags?.has("SCRIPT")).toBe(true)
    const wikipedia = resolveSiteRule("https://en.wikipedia.org/wiki/Example", BUILT_IN_SITE_RULES, [], [])
    expect(wikipedia.atomSelector).toContain("span.katex")
    expect(wikipedia.preserveTextSelector).toContain("span.katex")
  })
})
