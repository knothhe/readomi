// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { SiteRule } from "@/types/config/site-rules"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BLOCK_ATTRIBUTE, INLINE_ATTRIBUTE, PARAGRAPH_ATTRIBUTE, WALKED_ATTRIBUTE } from "@/utils/constants/dom-labels"
import { isDontWalkIntoButTranslateAsChildElement, isNaturalBlockTransNode, isNaturalInlineTransNode } from "../filter"
import { extractTextContent, walkAndLabelElement } from "../traversal"

const originalLocation = window.location

function fixture(markup: string, rule: Partial<SiteRule> = {}) {
  Object.defineProperty(window, "location", { value: new URL("https://host-rules.example/article"), configurable: true, writable: true })
  document.body.innerHTML = markup
  const config: Config = {
    ...DEFAULT_CONFIG,
    siteRules: { userRules: [{ id: "test", matches: "host-rules.example", ...rule }], disabledBuiltInRules: [] },
  }
  walkAndLabelElement(document.body, "site-rules-walk", config)
  return { config, element: (id: string) => document.getElementById(id)! }
}

afterEach(() => {
  document.body.replaceChildren()
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true })
})

describe("site rules in the host DOM walk", () => {
  it("restricts paragraphs to included regions and keeps excluded descendants closed", () => {
    const { element } = fixture("<article><p id='inside'>The article text</p><aside id='blocked'><p id='nested'>A promoted title</p></aside></article><p id='outside'>Page chrome</p>", {
      includeSelectors: ["article", "#nested"],
      excludeSelectors: ["aside"],
    })
    expect(element("inside")).toHaveAttribute(PARAGRAPH_ATTRIBUTE)
    expect(element("outside")).not.toHaveAttribute(PARAGRAPH_ATTRIBUTE)
    expect(element("nested")).not.toHaveAttribute(WALKED_ATTRIBUTE)
  })

  it("restores an element matching both include and exclude without restoring its siblings", () => {
    const { element } = fixture("<a data-kind='issue' id='issue'>An issue title</a><a data-kind='user' id='user'>Username</a>", {
      excludeSelectors: ["a[data-kind]"],
      includeSelectors: ["a[data-kind='issue']"],
    })
    expect(element("issue")).toHaveAttribute(PARAGRAPH_ATTRIBUTE)
    expect(element("user")).not.toHaveAttribute(WALKED_ATTRIBUTE)
  })

  it("keeps node overrides independent of the translation style classification", () => {
    const { element } = fixture("<span id='block' style='display:inline'>Inline source</span><div id='inline'>Block source</div>", {
      forceBlockNodeSelectors: ["#block"],
      forceInlineNodeSelectors: ["#inline"],
    })
    expect(element("block")).toHaveAttribute(BLOCK_ATTRIBUTE)
    expect(element("block")).not.toHaveAttribute(INLINE_ATTRIBUTE)
    expect(isNaturalInlineTransNode(element("block"))).toBe(true)
    expect(element("inline")).toHaveAttribute(INLINE_ATTRIBUTE)
    expect(element("inline")).not.toHaveAttribute(BLOCK_ATTRIBUTE)
    expect(isNaturalBlockTransNode(element("inline"))).toBe(true)
  })

  it("gives block node conflicts priority while leaving style-only rules out of traversal", () => {
    const { element } = fixture("<span id='conflict' style='display:inline'>Conflicting rules</span><span id='style' style='display:inline'>Style source</span>", {
      forceBlockNodeSelectors: ["#conflict"],
      forceInlineNodeSelectors: ["#conflict"],
      forceBlockStyleSelectors: ["#style"],
    })
    expect(element("conflict")).toHaveAttribute(BLOCK_ATTRIBUTE)
    expect(element("conflict")).not.toHaveAttribute(INLINE_ATTRIBUTE)
    expect(element("style")).toHaveAttribute(INLINE_ATTRIBUTE)
    expect(element("style")).not.toHaveAttribute(BLOCK_ATTRIBUTE)
  })

  it("stops at preserved text but includes it in the enclosing request text", () => {
    const { element, config } = fixture("<p id='paragraph'>Read <a class='preserved' id='link' href='/note'>this note</a> now.</p>", {
      preserveTextSelectors: [".preserved"],
      excludeSelectors: ["a"],
    })
    expect(isDontWalkIntoButTranslateAsChildElement(element("link"), config)).toBe(true)
    expect(element("link")).not.toHaveAttribute(WALKED_ATTRIBUTE)
    expect(extractTextContent(element("paragraph"), config)).toBe("Read this note now.")
  })

  it("applies tag-set deltas and relabels a fresh walk without stale classifications", () => {
    const { element, config } = fixture("<pre id='prose'>An unblocked prose excerpt</pre><span id='source' style='display:inline'>The source</span>", {
      "dontWalkTags.remove": ["PRE"],
      "forceBlockNodeSelectors": ["#source"],
    })
    expect(element("prose")).toHaveAttribute(PARAGRAPH_ATTRIBUTE)
    expect(element("source")).toHaveAttribute(BLOCK_ATTRIBUTE)
    walkAndLabelElement(document.body, "second-walk", { ...config, siteRules: { userRules: [], disabledBuiltInRules: [] } })
    expect(element("source")).not.toHaveAttribute(BLOCK_ATTRIBUTE)
    expect(element("source")).toHaveAttribute(INLINE_ATTRIBUTE)
    expect(element("prose")).not.toHaveAttribute(PARAGRAPH_ATTRIBUTE)
  })
})
