// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { isInsideSiteRuleSelector, matchesSiteRuleSelector } from "../site-rule-matching"

describe("long site selector lists", () => {
  it("retains commas inside functional selectors and attribute values when splitting batches", () => {
    const host = document.createElement("article")
    host.innerHTML = "<p data-label='one,two' class='target'><span>Content</span></p>"
    const source = host.firstElementChild!
    const selector = `${Array.from({ length: 170 }, (_, index) => `.unmatched-${index}`).join(",")},p:is(.target,.alternate)[data-label='one,two']`
    expect(selector.length).toBeGreaterThan(2048)
    expect(matchesSiteRuleSelector(source, selector)).toBe(true)
    expect(isInsideSiteRuleSelector(source.firstElementChild!, selector)).toBe(true)
    expect(matchesSiteRuleSelector(host, selector)).toBe(false)
  })
})
