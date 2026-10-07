import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "#imports"
import { openOptionsPage } from "../navigation"

describe("navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    browser.tabs.create = vi.fn().mockResolvedValue({})
  })

  it("opens the options page as an extension tab", async () => {
    await openOptionsPage()

    expect(browser.tabs.create).toHaveBeenCalledWith({
      active: true,
      url: "chrome-extension://test-extension-id/options.html",
    })
  })

  it("opens the options page scrolled to a section", async () => {
    await openOptionsPage({ section: "providers" })

    expect(browser.tabs.create).toHaveBeenCalledWith({
      active: true,
      url: "chrome-extension://test-extension-id/options.html#providers",
    })
  })

  it("opens saved site rules directly in the custom rules tab", async () => {
    await openOptionsPage({ section: "reading/site-rules", siteRulesTab: "custom" })
    expect(browser.tabs.create).toHaveBeenCalledWith({
      active: true,
      url: "chrome-extension://test-extension-id/options.html?siteRulesTab=custom#reading/site-rules",
    })
  })
})
