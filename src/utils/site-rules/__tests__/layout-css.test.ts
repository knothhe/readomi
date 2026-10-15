import postcss from "postcss"
import { describe, expect, it } from "vitest"
import { buildLayoutCSS, scopeBuiltInCSS } from "../../../../scripts/site-rule-layout-css.mjs"
import layoutCSS from "../built-in/layout-css.json"
import rawRules from "../built-in/rules.json"

describe("built-in CSS audit", () => {
  it("requires explicit review for global at-rules outside layout conditions", () => {
    expect(() => scopeBuiltInCSS("@font-face {font-family:HostFont;src:url(example.woff2)}")).toThrow("Review unsupported")
  })

  it("covers every CSS-bearing rule and stays reproducible from the unchanged upstream snapshot", () => {
    expect(Object.keys(layoutCSS)).toHaveLength(191)
    expect(buildLayoutCSS(rawRules)).toEqual(layoutCSS)
  })

  it("retains extension-only typography but removes host typography and structural rewrites", () => {
    const result = scopeBuiltInCSS(`
      .read-frog-translated-content-wrapper, span {
        font-size:24px; white-space:normal; display:grid; max-height:none;
      }
      body {overflow:scroll; font-size:20px}
      .promo {display:none}
      .grid {grid-template-columns:1fr; position:absolute; left:0}
    `)
    const rules = postcss.parse(result).nodes.filter(node => node.type === "rule")
    expect(rules[0].selector).toBe(".read-frog-translated-content-wrapper")
    expect(rules[0].toString()).toContain("font-size:24px")
    expect(rules[1].selector).toContain("[data-readomi-layout-owner]")
    expect(rules[1].nodes.filter(node => node.type === "decl").map(node => node.prop)).toEqual(["max-height"])
    expect(rules[2].selector).toContain("[data-readomi-layout-owner]")
    expect(result).not.toContain(".promo")
    expect(result).not.toContain(".grid")
  })

  it("handles selector lists, quoted commas, nested conditions and positive extension ownership", () => {
    const result = scopeBuiltInCSS(`
      @media (min-width: 600px) {
        :is(.one,.two), [data-label="a,b"] {height:auto}
        p:has(.read-frog-translated-content-wrapper) {max-height:none}
        p:not(.read-frog-translated-content-wrapper) {font-size:30px}
        a::after {position:relative}
        .read-frog-translated-content-wrapper br {display:none}
      }
    `)
    const selectors: string[] = []
    postcss.parse(result).walkRules((rule) => {
      selectors.push(...rule.selectors)
    })
    expect(selectors).toHaveLength(4)
    expect(selectors.slice(0, 3).every(selector => selector.includes("[data-readomi-layout-owner]"))).toBe(true)
    expect(selectors.at(-1)).toBe(".read-frog-translated-content-wrapper br")
    expect(result).toContain("@media")
    expect(result).not.toContain("font-size")
    expect(result).not.toContain("::after")
  })

  it("never reintroduces an unconditional host rule anywhere in the full CSS library", () => {
    for (const [id, fields] of Object.entries(layoutCSS)) {
      const fragments = [("injectedCss" in fields ? fields.injectedCss : ""), ...("injectedCss.add" in fields ? fields["injectedCss.add"] : [])]
      for (const css of fragments) {
        postcss.parse(css).walkRules((rule) => {
          for (const selector of rule.selectors) {
            if (!selector.includes("[data-readomi-layout-owner]")) {
              expect(selector, id).toMatch(/\.read-frog-translated-(?:content-wrapper|inline-content|block-content)/)
              expect(selector, id).not.toMatch(/:has\(/)
            }
          }
        })
      }
    }
  })
})
