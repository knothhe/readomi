import type { SiteRule } from "@/types/config/site-rules"
import { describe, expect, it } from "vitest"
import { normalizeBuiltInSiteRuleId, normalizeDisabledBuiltInRuleIds, toReadomiSiteRule } from "../branding"
import upstreamRules from "../built-in/rules.json"

describe("readomi public rule branding", () => {
  it("renames every shipped legacy product rule ID while keeping unrelated and unknown IDs", () => {
    for (const rule of upstreamRules.filter(rule => rule.id.startsWith("readfrog-"))) {
      expect(normalizeBuiltInSiteRuleId(rule.id)).toBe(rule.id.replace("readfrog-", "readomi-"))
    }
    expect(normalizeBuiltInSiteRuleId("twitter")).toBe("twitter")
    expect(normalizeBuiltInSiteRuleId("readomi-github")).toBe("readomi-github")
    expect(normalizeBuiltInSiteRuleId("readfrog-unknown")).toBe("readfrog-unknown")
  })

  it("normalizes legacy disabled IDs, dedupes aliases and keeps unknown values in order", () => {
    expect(normalizeDisabledBuiltInRuleIds([
      "readfrog-github", "twitter", "readomi-github", "readfrog-unknown", "readfrog-youtube",
    ])).toEqual(["readomi-github", "twitter", "readfrog-unknown", "readomi-youtube"])
  })

  it("brands descriptions, selectors and CSS without changing the upstream snapshot", () => {
    const source: SiteRule = {
      "id": "readfrog-youtube", "description": "Skip Read Frog subtitle UI", "matches": "www.youtube.com",
      "excludeSelectors": [".read-frog-subtitles-view"],
      "excludeSelectors.remove": ["[data-read-frog-walked]"],
      "injectedCss.add": [".read-frog-translated-content-wrapper { display:block; }"],
    }
    const branded = toReadomiSiteRule(source)
    expect(branded).toEqual({
      "id": "readomi-youtube", "description": "Skip Readomi subtitle UI", "matches": "www.youtube.com",
      "excludeSelectors": [".readomi-subtitles-view"],
      "excludeSelectors.remove": ["[data-readomi-walked]"],
      "injectedCss.add": [".readomi-translated-content-wrapper { display:block; }"],
    })
    expect(source.id).toBe("readfrog-youtube")
    expect(source.excludeSelectors).toEqual([".read-frog-subtitles-view"])
    expect(toReadomiSiteRule(source)).toBe(branded)
    expect(toReadomiSiteRule(branded)).toBe(branded)
  })
})
