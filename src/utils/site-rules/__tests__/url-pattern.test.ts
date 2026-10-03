import { describe, expect, it } from "vitest"
import { urlMatchesPattern } from "../url-pattern"

describe("urlMatchesPattern", () => {
  it("matches the exact host for bare hostnames, excluding subdomains", () => {
    expect(urlMatchesPattern("https://github.com/foo", "github.com")).toBe(true)
    expect(urlMatchesPattern("http://github.com/", "github.com")).toBe(true)
    expect(urlMatchesPattern("https://gist.github.com/foo", "github.com")).toBe(false)
  })

  /**
   * The dot after a leading `*` is optional, and everything about how a stored
   * `*.host` behaves rests on it. MatchPattern compiles two host regexes — the
   * pattern as written, and the pattern with a leading `*.` removed, dot
   * included — so the apex matches. The in-repo wildcard engine mirrors that by
   * collapsing a leading `[a-z0-9.-]*\.` into `(?:[^.]+\.)*`, which also
   * allows zero labels.
   */
  it("matches apex and subdomains for *. patterns", () => {
    expect(urlMatchesPattern("https://example.com/", "*.example.com")).toBe(true)
    expect(urlMatchesPattern("https://sub.example.com/x", "*.example.com")).toBe(true)
    expect(urlMatchesPattern("https://deep.sub.example.com/x", "*.example.com")).toBe(true)
    expect(urlMatchesPattern("https://notexample.com/", "*.example.com")).toBe(false)
    expect(urlMatchesPattern("https://example.com.evil.com/", "*.example.com")).toBe(false)
  })

  it("gives an exact host with any scheme when written the long way", () => {
    expect(urlMatchesPattern("https://example.com/", "*://example.com/*")).toBe(true)
    expect(urlMatchesPattern("http://example.com/x", "*://example.com/*")).toBe(true)
    expect(urlMatchesPattern("https://www.example.com/", "*://example.com/*")).toBe(false)
  })

  it("supports mid-path wildcards", () => {
    expect(urlMatchesPattern("https://github.com/a/b/settings", "github.com/*/settings")).toBe(true)
    expect(urlMatchesPattern("https://github.com/a/b", "github.com/*/settings")).toBe(false)
  })

  it("treats a path without a wildcard as exact, and is case-sensitive there", () => {
    expect(urlMatchesPattern("https://example.com/docs", "example.com/docs")).toBe(true)
    expect(urlMatchesPattern("https://example.com/docs/x", "example.com/docs")).toBe(false)
    expect(urlMatchesPattern("https://example.com/docs/x", "example.com/docs/*")).toBe(true)
    expect(urlMatchesPattern("https://example.com/docs", "example.com/Docs")).toBe(false)
  })

  it("ignores query strings", () => {
    expect(urlMatchesPattern("https://github.com/foo?tab=readme", "github.com/foo")).toBe(true)
    expect(urlMatchesPattern("https://example.com/a?q=1#h", "example.com/a")).toBe(true)
  })

  it("matches any TLD for trailing .* wildcards", () => {
    expect(urlMatchesPattern("https://www.amazon.com/dp/1", "www.amazon.*")).toBe(true)
    expect(urlMatchesPattern("https://www.amazon.co.jp/dp/1", "www.amazon.*")).toBe(true)
    expect(urlMatchesPattern("https://www.amazonaws.com/", "www.amazon.*")).toBe(false)
    expect(
      urlMatchesPattern("https://scholar.google.co.uk/scholar?q=x", "scholar.google.*/*"),
    ).toBe(true)
  })

  it("matches apex and subdomains for patterns with both leading and trailing wildcards", () => {
    expect(urlMatchesPattern("https://weibo.com/u/1", "*.weibo.*")).toBe(true)
    expect(urlMatchesPattern("https://m.weibo.cn/detail/2", "*.weibo.*")).toBe(true)
    expect(urlMatchesPattern("https://notweibo.com/", "*.weibo.*")).toBe(false)
  })

  it("matches mid-host wildcards", () => {
    expect(urlMatchesPattern("https://javdb007.com/x", "javdb*.com")).toBe(true)
    expect(urlMatchesPattern("https://javdb.com/x", "javdb*.com")).toBe(true)
    expect(urlMatchesPattern("https://example.com/", "javdb*.com")).toBe(false)
  })

  it("restricts wildcard-host patterns to http(s) and ignores query strings", () => {
    expect(urlMatchesPattern("ftp://www.amazon.com/", "www.amazon.*")).toBe(false)
    expect(urlMatchesPattern("https://www.amazon.de/dp/1?ref=nav", "www.amazon.*/dp/*")).toBe(true)
  })

  it("matches localhost and loopback IPs regardless of port", () => {
    expect(urlMatchesPattern("http://localhost:8000/", "localhost")).toBe(true)
    expect(urlMatchesPattern("http://localhost/chat", "localhost")).toBe(true)
    expect(urlMatchesPattern("http://127.0.0.1:8000/chat", "127.0.0.1")).toBe(true)
    expect(urlMatchesPattern("http://localhost.evil.com/", "localhost")).toBe(false)
    expect(urlMatchesPattern("http://[::1]:8000/x", "[::1]")).toBe(true)
  })

  it("returns false for URLs it cannot handle instead of throwing", () => {
    expect(urlMatchesPattern("not a url", "github.com")).toBe(false)
    expect(urlMatchesPattern("not a url", "www.amazon.*")).toBe(false)
    expect(urlMatchesPattern("file:///etc/hosts", "github.com")).toBe(false)
    expect(urlMatchesPattern("about:blank", "github.com")).toBe(false)
    expect(urlMatchesPattern("chrome-extension://abc/options.html", "*")).toBe(false)
  })

  it("returns false for invalid patterns instead of throwing", () => {
    expect(urlMatchesPattern("https://github.com/", "example.com:8080")).toBe(false)
    expect(urlMatchesPattern("https://github.com/", "")).toBe(false)
  })
})
