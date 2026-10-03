// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { clearSiteRuleStyles, ensureSiteRuleStyles, refreshSiteRuleStyles, retainPageSiteRuleStyles } from "../site-rule-styles"

const originalLocation = window.location
const config: Config = {
  ...DEFAULT_CONFIG,
  siteRules: {
    userRules: [{ id: "layout", matches: "styles.example/article*", injectedCss: ".article { max-height: unset; }" }],
    disabledBuiltInRules: [],
  },
}

afterEach(() => {
  clearSiteRuleStyles()
  document.body.replaceChildren()
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true })
})

describe("site rule CSS ownership", () => {
  it("updates already-translated document and shadow roots when the route or rules change", () => {
    Object.defineProperty(window, "location", { value: new URL("https://styles.example/article/1"), configurable: true, writable: true })
    const host = document.createElement("div")
    document.body.append(host)
    const shadow = host.attachShadow({ mode: "open" })
    ensureSiteRuleStyles(document, config)
    ensureSiteRuleStyles(shadow, config)
    expect(document.head.querySelector("#readomi-site-rule-styles")?.textContent).toContain("max-height: unset")
    expect(shadow.querySelector("#readomi-site-rule-styles")?.textContent).toContain("max-height: unset")
    refreshSiteRuleStyles(config, "https://styles.example/settings")
    expect(document.head.querySelector("#readomi-site-rule-styles")).toBeNull()
    expect(shadow.querySelector("#readomi-site-rule-styles")).toBeNull()
    refreshSiteRuleStyles(config, "https://styles.example/article/2")
    expect(shadow.querySelector("#readomi-site-rule-styles")).not.toBeNull()
    refreshSiteRuleStyles({ ...config, siteRules: { userRules: [], disabledBuiltInRules: [] } })
    expect(document.head.querySelector("#readomi-site-rule-styles")).toBeNull()
    expect(shadow.querySelector("#readomi-site-rule-styles")).toBeNull()
  })

  it("removes only its own stylesheet and leaves site and custom styles intact", () => {
    Object.defineProperty(window, "location", { value: new URL("https://styles.example/article"), configurable: true, writable: true })
    const hostStyle = document.createElement("style")
    hostStyle.id = "readomi-site-rule-styles"
    hostStyle.textContent = ".host-owned { color: red; }"
    const customStyle = document.createElement("style")
    customStyle.id = "readomi-custom-styles"
    document.head.append(hostStyle, customStyle)
    ensureSiteRuleStyles(document, config)
    clearSiteRuleStyles()
    expect(hostStyle.isConnected).toBe(true)
    expect(hostStyle.textContent).toBe(".host-owned { color: red; }")
    expect(customStyle.isConnected).toBe(true)
    hostStyle.remove()
    customStyle.remove()
  })

  it("releases a detached translated shadow root while the page session remains active", async () => {
    Object.defineProperty(window, "location", { value: new URL("https://styles.example/article"), configurable: true, writable: true })
    const release = retainPageSiteRuleStyles(config)
    const host = document.createElement("div")
    document.body.append(host)
    const shadow = host.attachShadow({ mode: "open" })
    const wrapper = document.createElement("span")
    wrapper.className = CONTENT_WRAPPER_CLASS
    shadow.append(wrapper)
    ensureSiteRuleStyles(shadow, config)
    expect(shadow.querySelector("#readomi-site-rule-styles")).not.toBeNull()
    host.remove()
    await vi.waitFor(() => expect(shadow.querySelector("#readomi-site-rule-styles")).toBeNull())
    expect(document.head.querySelector("#readomi-site-rule-styles")).not.toBeNull()
    release()
  })

  it("detects removal of a hover-only shadow host without a document stylesheet", async () => {
    Object.defineProperty(window, "location", { value: new URL("https://styles.example/article"), configurable: true, writable: true })
    const host = document.createElement("div")
    document.body.append(host)
    const shadow = host.attachShadow({ mode: "open" })
    const wrapper = document.createElement("span")
    wrapper.className = CONTENT_WRAPPER_CLASS
    shadow.append(wrapper)
    ensureSiteRuleStyles(shadow, config)
    expect(document.head.querySelector("#readomi-site-rule-styles")).toBeNull()
    host.remove()
    await vi.waitFor(() => expect(shadow.querySelector("#readomi-site-rule-styles")).toBeNull())
  })
})
