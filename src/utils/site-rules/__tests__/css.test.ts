import { describe, expect, it } from "vitest"
import { sanitizeSiteRuleCss } from "../css"

describe("site rule CSS", () => {
  it("keeps layout declarations and rejects empty fragments", () => {
    const css = ".title { -webkit-line-clamp: unset !important; overflow: visible; }"
    expect(sanitizeSiteRuleCss(css)).toBe(css)
    expect(sanitizeSiteRuleCss("  ")).toBeNull()
  })

  it.each([
    "@import 'https://example.com/style.css';",
    ".title { background: url(https://example.com/image); }",
    ".title { background: image-set('https://example.com/image' 1x); }",
    ".title { width: expression(alert(1)); }",
    ".title { -moz-binding: none; }",
    ".title { behavior: none; }",
    "@im/**/port 'https://example.com/style.css';",
    "@\\69mport 'https://example.com/style.css';",
    ".title { background: u\\72 l(https://example.com/image); }",
    ".title { background: u/**/rl(https://example.com/image); }",
    "a".repeat(8193),
  ])("drops unsafe or oversized CSS: %s", (css) => {
    expect(sanitizeSiteRuleCss(css)).toBeNull()
  })

  it("does not throw on invalid Unicode escape values", () => {
    expect(() => sanitizeSiteRuleCss(".\\FFFFFF { color: red; }")).not.toThrow()
  })
})
