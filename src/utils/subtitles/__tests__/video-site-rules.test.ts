import type { VideoSiteRule } from "@/types/config/video-site-rules"
import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { isVideoTranslationExcluded, normalizeVideoSiteRule } from "../video-site-rules"

describe("video translation site exclusions", () => {
  const domain: VideoSiteRule[] = [{ type: "domain", value: "example.com" }]

  it("excludes the apex and nested subdomains with strict hostname boundaries", () => {
    expect(isVideoTranslationExcluded("https://example.com/watch/1", domain)).toBe(true)
    expect(isVideoTranslationExcluded("http://deep.video.example.com:8080/watch/1", domain)).toBe(true)
    expect(isVideoTranslationExcluded("https://notexample.com/watch/1", domain)).toBe(false)
    expect(isVideoTranslationExcluded("https://example.com.evil.test/watch/1", domain)).toBe(false)
    expect(isVideoTranslationExcluded("https://evil.test/example.com", domain)).toBe(false)
  })

  it("normalizes domains, trailing dots and international hostnames", () => {
    expect(normalizeVideoSiteRule({ type: "domain", value: " Example.COM. " })).toEqual(domain[0])
    expect(isVideoTranslationExcluded("https://example.com./", domain)).toBe(true)
    const international = [{ type: "domain", value: "例子.测试" }] as const
    expect(normalizeVideoSiteRule(international[0])).toEqual({ type: "domain", value: "xn--fsqu00a.xn--0zwm56d" })
    expect(isVideoTranslationExcluded("https://子域.例子.测试/watch", international)).toBe(true)
    expect(isVideoTranslationExcluded("https://xn--fsqu00a.xn--0zwm56d/", international)).toBe(true)
  })

  it("handles local hostnames and IP addresses without including ports", () => {
    expect(isVideoTranslationExcluded("http://localhost:3000/watch", [{ type: "domain", value: "LOCALHOST" }])).toBe(true)
    expect(isVideoTranslationExcluded("http://video.localhost:3000/", [{ type: "domain", value: "localhost" }])).toBe(true)
    expect(isVideoTranslationExcluded("http://127.0.0.1:8080/", [{ type: "domain", value: "127.0.0.1" }])).toBe(true)
    expect(isVideoTranslationExcluded("http://127.0.0.2/", [{ type: "domain", value: "127.0.0.1" }])).toBe(false)
    expect(normalizeVideoSiteRule({ type: "domain", value: "::1" })).toEqual({ type: "domain", value: "[::1]" })
    expect(isVideoTranslationExcluded("http://[::1]:8080/", [{ type: "domain", value: "[::1]" }])).toBe(true)
    expect(isVideoTranslationExcluded("http://[::2]/", [{ type: "domain", value: "::1" }])).toBe(false)
  })

  it("rejects explicit domain-rule ports including a default IPv6 port", () => {
    for (const value of ["[::1]:80", "[::1]:443", "[::1]:", "127.0.0.1:80", "localhost:80", "example.com:80"]) {
      expect(normalizeVideoSiteRule({ type: "domain", value })).toBeNull()
    }
  })

  it("reuses host and path wildcard semantics and ignores query, hash and port", () => {
    const rules: VideoSiteRule[] = [{ type: "pattern", value: "*.example.com/watch/*" }]
    expect(normalizeVideoSiteRule(rules[0]!)).toEqual({ type: "pattern", value: "*://*.example.com/watch/*" })
    expect(isVideoTranslationExcluded("https://example.com:3000/watch/1?lang=en#chapter", rules)).toBe(true)
    expect(isVideoTranslationExcluded("http://deep.video.example.com/watch/2", rules)).toBe(true)
    expect(isVideoTranslationExcluded("https://video.example.com/Watch/2", rules)).toBe(false)
    expect(isVideoTranslationExcluded("https://example.com/shorts/2", rules)).toBe(false)
    expect(isVideoTranslationExcluded("https://notexample.com/watch/2", rules)).toBe(false)
    expect(isVideoTranslationExcluded("http://example.com/watch/1", [{ type: "pattern", value: "https://example.com/watch/*" }])).toBe(false)
  })

  it("matches a domain's trailing dot in URL patterns while preserving the original URL for regex rules", () => {
    const url = "https://video.example.com./watch/1"
    expect(isVideoTranslationExcluded(url, [{ type: "pattern", value: "*://*.example.com/watch/*" }])).toBe(true)
    expect(isVideoTranslationExcluded(url, [{ type: "regex", value: "^https://video\\.example\\.com\\./watch/1$" }])).toBe(true)
    expect(isVideoTranslationExcluded(url, [{ type: "regex", value: "^https://video\\.example\\.com/watch/1$" }])).toBe(false)
  })

  it("validates wildcard hostnames and encodes international labels", () => {
    for (const value of ["example!.com/*", "example..com/*", "-example.com/*", "example.com/watch?lang=*", "example.com/watch#chapter", "example.com/bad path"])
      expect(normalizeVideoSiteRule({ type: "pattern", value })).toBeNull()
    const rules: VideoSiteRule[] = [{ type: "pattern", value: "*.例子.测试/watch/*" }]
    expect(normalizeVideoSiteRule(rules[0]!)).toEqual({ type: "pattern", value: "*://*.xn--fsqu00a.xn--0zwm56d/watch/*" })
    expect(isVideoTranslationExcluded("https://子域.例子.测试/watch/1", rules)).toBe(true)
    expect(isVideoTranslationExcluded("http://[::1]:3000/watch/1", [{ type: "pattern", value: "[::1]/watch/*" }])).toBe(true)
    expect(isVideoTranslationExcluded("https://anything.example/watch/1", [{ type: "pattern", value: "*/watch/*" }])).toBe(true)
  })

  it("matches regular expressions against the complete URL without case sensitivity", () => {
    const rules: VideoSiteRule[] = [{ type: "regex", value: "^https://([^.]+\\.)?example\\.com/watch\\?lang=EN#end$" }]
    expect(isVideoTranslationExcluded("https://video.example.com/watch?lang=en#END", rules)).toBe(true)
    expect(isVideoTranslationExcluded("https://example.com/watch?lang=en#end", rules)).toBe(true)
    expect(isVideoTranslationExcluded("https://video.example.com/watch?lang=fr#end", rules)).toBe(false)
    expect(isVideoTranslationExcluded("https://example.com/watch?lang=en", rules)).toBe(false)
  })

  it.each(["", "https://example.com", "example.com/watch", "example.com:443", "user@example.com", "*.example.com", "-example.com", "example..com", "example.com?x=1", "bad domain", "example.com\\path"])("rejects an invalid domain %s before saving", (value) => {
    expect(normalizeVideoSiteRule({ type: "domain", value })).toBeNull()
  })

  it("ignores invalid rules and unsupported URLs without throwing", () => {
    const rules: VideoSiteRule[] = [{ type: "regex", value: "[" }, { type: "pattern", value: "ftp://example.com/*" }, { type: "domain", value: "" }]
    expect(normalizeVideoSiteRule(rules[0]!)).toBeNull()
    expect(normalizeVideoSiteRule(rules[1]!)).toBeNull()
    expect(isVideoTranslationExcluded("https://example.com/", rules)).toBe(false)
    expect(isVideoTranslationExcluded("not a url", domain)).toBe(false)
    expect(isVideoTranslationExcluded("file:///example.com/", [{ type: "regex", value: ".*" }])).toBe(false)
    expect(isVideoTranslationExcluded("https://example.com/", [])).toBe(false)
  })

  it("defaults old configurations without replacing any existing settings", () => {
    const { videoExcludedSites: _videoExcludedSites, ...previousFeatures } = DEFAULT_CONFIG.features
    const old = { ...DEFAULT_CONFIG, language: { ...DEFAULT_CONFIG.language, targetCode: "jpn" }, features: { ...previousFeatures, videoSubtitles: true } }
    const parsed = configSchema.parse(old)
    expect(parsed.features.videoExcludedSites).toEqual([])
    expect(parsed.features.videoSubtitles).toBe(true)
    expect(parsed.language.targetCode).toBe("jpn")
    expect(parsed.providersConfig).toEqual(old.providersConfig)
    expect(parsed.features.subtitleStyle).toEqual(old.features.subtitleStyle)
  })

  it("keeps an invalid regex in a restored config from resetting unrelated settings", () => {
    const config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoSubtitles: true, videoExcludedSites: [{ type: "regex", value: "[" }] } }
    expect(configSchema.parse(config).features.videoSubtitles).toBe(true)
  })
})
