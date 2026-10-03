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
  clearSiteRuleStyles()
  document.body.replaceChildren()
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true })
})

describe("resolved site rule translation", () => {
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
    expect(translateTextForPage).toHaveBeenCalledWith("The formula {{0}} is useful.")
    const clone = root.querySelector(`.${INLINE_ATOM_CLASS}`)!
    expect(clone).toHaveTextContent("x²")
    expect(clone).not.toHaveAttribute("id")
    expect(clone.querySelector("b")).not.toHaveAttribute("onclick")
    expect(root.querySelector("#formula #symbol")).toHaveAttribute("onclick", "evil()")
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)?.textContent).toBe("译文 The formula x² is useful.")
  })
})
