// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { SiteRule } from "@/types/config/site-rules"
import { act } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BLOCK_CONTENT_CLASS, CONTENT_WRAPPER_CLASS, INLINE_ATOM_CLASS, INLINE_CONTENT_CLASS } from "@/utils/constants/dom-labels"
import { flushBatchedOperations } from "@/utils/host/dom/batch-dom"
import { walkAndLabelElement } from "@/utils/host/dom/traversal"
import { translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { translateTextForPage } from "@/utils/host/translate/translate-variants"
import { clearSiteRuleStyles } from "@/utils/host/translate/ui/site-rule-styles"
import { LAYOUT_OWNER_ATTRIBUTE } from "@/utils/host/translate/ui/translation-layout-ownership"

vi.mock("@/utils/host/translate/translate-variants", () => ({ translateTextForPage: vi.fn((text: string) => Promise.resolve(`译文 ${text}`)) }))
const originalLocation = window.location

async function translate(markup: string, rule: Partial<SiteRule>, rootId = "source") {
  Object.defineProperty(window, "location", { value: new URL("https://translation-rules.example/article"), configurable: true, writable: true })
  document.body.innerHTML = markup
  const config: Config = { ...DEFAULT_CONFIG, siteRules: { userRules: [{ id: "translation-test", matches: "translation-rules.example", ...rule }], disabledBuiltInRules: [] } }
  const root = document.getElementById(rootId)!
  walkAndLabelElement(root, "translation-rule-walk", config)
  await act(async () => {
    await translateWalkedElement(root, "translation-rule-walk", config)
    flushBatchedOperations()
  })
  return root
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  clearSiteRuleStyles()
  document.body.replaceChildren()
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true })
})

describe("resolved site rule translation", () => {
  it("keeps the virtual-list shell hidden while translating its explicitly visible item", async () => {
    Object.defineProperty(window, "location", { value: new URL("https://community.ui.com/releases/example"), configurable: true, writable: true })
    document.body.innerHTML = "<div id='shell' style='flex: 0 0 auto; position: relative; visibility: hidden'>Hidden shell text<span>Hidden list metadata</span><div style='position: absolute; visibility: visible'><p id='visible'>A visible release announcement.</p></div></div><p style='visibility:hidden'>Another hidden paragraph.</p>"
    const shell = document.getElementById("shell")!
    const originalStyle = shell.getAttribute("style")
    walkAndLabelElement(document.body, "virtual-list", DEFAULT_CONFIG)
    await act(async () => {
      await translateWalkedElement(document.body, "virtual-list", DEFAULT_CONFIG)
      flushBatchedOperations()
    })
    expect(translateTextForPage).toHaveBeenCalledTimes(1)
    expect(translateTextForPage).toHaveBeenCalledWith("A visible release announcement.", expect.any(Object))
    expect(document.getElementById("visible")).toHaveTextContent("译文 A visible release announcement.")
    expect(shell.getAttribute("style")).toBe(originalStyle)
    expect(getComputedStyle(shell).visibility).toBe("hidden")
  })

  it.each(["bilingual", "translationOnly"] as const)("does not change a preserved or filtered source's truncation in %s mode", async (mode) => {
    Object.defineProperty(window, "location", { value: new URL("https://example.com"), configurable: true, writable: true })
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => callback())
    document.body.innerHTML = "<p id='preserved' style='max-height:48px;-webkit-line-clamp:2'><span>Keep this paragraph intact.</span></p><p id='numeric' style='max-height:24px'><span>12345</span></p>"
    const config: Config = { ...DEFAULT_CONFIG, translate: { ...DEFAULT_CONFIG.translate, mode } }
    const preserved = document.getElementById("preserved")!
    const numeric = document.getElementById("numeric")!
    const styles = [preserved.getAttribute("style"), numeric.getAttribute("style")]
    vi.mocked(translateTextForPage).mockImplementationOnce(text => Promise.resolve(text))
    for (const source of [preserved, numeric]) {
      walkAndLabelElement(source, "preserve-layout", config)
      await act(async () => {
        await translateWalkedElement(source, "preserve-layout", config)
        flushBatchedOperations()
      })
      expect(source.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
      expect(source).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    }
    expect([preserved.getAttribute("style"), numeric.getAttribute("style")]).toEqual(styles)
  })

  it("uses node-only block rules to segment without changing inline presentation", async () => {
    const root = await translate("<span id='source' style='display:inline'>A compact label</span>", { forceBlockNodeSelectors: ["#source"] })
    expect(root.querySelector(`.${INLINE_CONTENT_CLASS}`)).toHaveTextContent("译文 A compact label")
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toBeNull()
  })

  it("uses explicit style overrides over natural layout and conflicting inline styles", async () => {
    const root = await translate("<span id='source' style='display:inline'>A compact label</span>", { forceBlockStyleSelectors: ["#source"], forceInlineStyleSelectors: ["#source"] })
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toHaveTextContent("译文 A compact label")
    expect(root.querySelector(`.${INLINE_CONTENT_CLASS}`)).toBeNull()
  })

  it("forces inline styling without combining separately segmented paragraphs", async () => {
    const root = await translate("<div id='source'>A natural block</div>", { forceInlineStyleSelectors: ["#source"] })
    expect(root.querySelector(`.${INLINE_CONTENT_CLASS}`)).toHaveTextContent("译文 A natural block")
    expect(root.querySelectorAll(`.${CONTENT_WRAPPER_CLASS}`)).toHaveLength(1)
  })

  it("applies both per-site character and language-aware word thresholds before requesting", async () => {
    const root = await translate("<p id='source'>Tiny paragraph</p>", { minCharacters: 50, minWords: 5 })
    expect(translateTextForPage).not.toHaveBeenCalled()
    expect(root.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    await translate("<p id='source'>Two words</p>", { minCharacters: 0, minWords: 3 })
    expect(translateTextForPage).not.toHaveBeenCalled()
  })

  it("sends opaque formula placeholders and restores sanitized formulas in the translated text", async () => {
    const root = await translate("<p id='source'>The formula <span class='formula' id='formula'><b id='symbol' onclick='evil()'>x²</b></span> is useful.</p>", { atomSelectors: [".formula"] })
    expect(translateTextForPage).toHaveBeenCalledWith("The formula {{0}} is useful.", expect.objectContaining({ onTargetLanguage: expect.any(Function) }))
    const clone = root.querySelector(`.${INLINE_ATOM_CLASS}`)!
    expect(clone).toHaveTextContent("x²")
    expect(clone).not.toHaveAttribute("id")
    expect(clone.querySelector("b")).not.toHaveAttribute("onclick")
    expect(root.querySelector("#formula #symbol")).toHaveAttribute("onclick", "evil()")
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)?.textContent).toBe("译文 The formula x² is useful.")
  })
})
