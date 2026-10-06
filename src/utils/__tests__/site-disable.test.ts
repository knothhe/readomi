import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { DEFAULT_CONFIG } from "../constants/config"
import { isSiteDisabled, siteHostname } from "../site-disable"

const config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, disabledSites: ["example.com"] } }

describe("hostname-scoped extension disabling", () => {
  it.each(["http://EXAMPLE.com:8080/article", "https://example.com./other?id=1#section"])("disables every page of the saved hostname: %s", (url) => {
    expect(siteHostname(url)).toBe("example.com")
    expect(isSiteDisabled(url, config)).toBe(true)
  })
  it.each(["https://sub.example.com/", "https://notexample.com/", "https://example.com.evil.test/", "file:///example.com", "chrome://extensions/", "invalid"])("leaves other hosts and unsupported pages enabled: %s", (url) => {
    expect(isSiteDisabled(url, config)).toBe(false)
  })
  it("adds the default to older configurations while preserving video exclusion and service preferences", () => {
    const { disabledSites: _, ...features } = DEFAULT_CONFIG.features
    const legacy = { ...DEFAULT_CONFIG, features: { ...features, videoExcludedSites: [{ type: "domain", value: "youtube.com" }] } }
    expect(configSchema.parse(legacy)).toEqual({ ...legacy, features: { ...legacy.features, disabledSites: [] } })
  })
})
