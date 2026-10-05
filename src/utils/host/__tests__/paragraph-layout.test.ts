// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { SiteRule } from "@/types/config/site-rules"
import type { PageTranslationRequest } from "@/utils/host/translate/stream-request"
import { act } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BLOCK_CONTENT_CLASS, CONTENT_WRAPPER_CLASS, INLINE_CONTENT_CLASS } from "@/utils/constants/dom-labels"
import { flushBatchedOperations } from "@/utils/host/dom/batch-dom"
import { walkAndLabelElement } from "@/utils/host/dom/traversal"
import { translateNodes, translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { getPendingTranslationLayout } from "@/utils/host/translate/ui/translation-layout"

vi.mock("@/utils/host/translate/translate-variants", () => ({
  translateTextForPage: vi.fn(() => Promise.resolve("完整段落的译文。")),
}))

afterEach(() => {
  document.body.replaceChildren()
})

async function translate(markup: string, rule: Partial<SiteRule> = {}, request?: PageTranslationRequest) {
  document.body.innerHTML = markup
  const config: Config = {
    ...DEFAULT_CONFIG,
    translate: {
      ...DEFAULT_CONFIG.translate,
      mode: "bilingual",
      translationNodeStyle: { preset: "line", isCustom: false, customCSS: "" },
    },
    siteRules: { userRules: [{ id: "paragraph-layout", matches: "*", ...rule }], disabledBuiltInRules: [] },
  }
  const walkId = crypto.randomUUID()
  walkAndLabelElement(document.body, walkId, config)
  await act(async () => {
    await translateWalkedElement(document.body, walkId, config, false, undefined, request)
    flushBatchedOperations()
  })
  return { config, root: document.getElementById("source")! }
}

describe("complete paragraph translation layout", () => {
  it.each(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "figcaption"])("keeps a complete %s block through nested inline spans and restores it on toggle", async (tag) => {
    const markup = `<${tag} id="source"><span style="display:inline"><span style="display:inline">A complete paragraph with enough words.</span></span></${tag}>`
    const { root, config } = await translate(markup)
    const translation = root.querySelector(`.${BLOCK_CONTENT_CLASS}`)!
    expect(translation).toHaveTextContent("完整段落的译文。")
    expect(translation).toHaveAttribute("data-readomi-custom-translation-style", "line")
    expect(translation.parentElement?.parentElement).toBe(root.querySelector("span span"))
    expect(root.querySelector(`.${INLINE_CONTENT_CLASS}`)).toBeNull()
    expect(root.querySelectorAll(`.${CONTENT_WRAPPER_CLASS}`)).toHaveLength(1)

    const walkId = crypto.randomUUID()
    walkAndLabelElement(document.body, walkId, config)
    await act(async () => {
      await translateWalkedElement(document.body, walkId, config, true)
      flushBatchedOperations()
    })
    expect(document.body.innerHTML).toContain("A complete paragraph with enough words.")
    expect(root.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
  })

  it("uses the same layout for a single span and a paragraph containing a link", async () => {
    await translate("<article id=\"source\"><p><span style=\"display:inline\">A complete paragraph with enough words.</span></p><p><span style=\"display:inline\">A complete paragraph </span><a href=\"/note\">with enough words.</a></p></article>")
    for (const paragraph of document.querySelectorAll("p")) {
      expect(paragraph.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toHaveTextContent("完整段落的译文。")
      expect(paragraph.querySelector(`.${INLINE_CONTENT_CLASS}`)).toBeNull()
    }
  })

  it("finds a semantic paragraph inside generic single-child containers", async () => {
    const { root } = await translate("<div id=\"source\"><div><p><span style=\"display:inline\">A complete paragraph with enough words.</span></p></div></div>")
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toHaveTextContent("完整段落的译文。")
  })

  it.each([
    "<div id=\"source\"><span style=\"display:inline\">An inline label with enough words.</span></div>",
    "<p id=\"source\"><a href=\"/note\"><span style=\"display:inline\">A linked label with enough words.</span></a></p>",
    "<p id=\"source\"><button><span style=\"display:inline\">A button label with enough words.</span></button></p>",
    "<p id=\"source\" style=\"display:flex\"><span style=\"display:inline\">A flex label with enough words.</span></p>",
    "<p id=\"source\"><span style=\"display:inline-flex\">An inline flex label with enough words.</span></p>",
  ])("preserves inline labels, controls and flex layouts: %s", async (markup) => {
    const { root } = await translate(markup)
    expect(root.querySelector(`.${INLINE_CONTENT_CLASS}`)).toHaveTextContent("完整段落的译文。")
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toBeNull()
  })

  it("does not promote a selected phrase just because it is inside a paragraph", async () => {
    document.body.innerHTML = "<p>Other prose <span id=\"phrase\" style=\"display:inline\">A phrase with enough words.</span> continues here.</p>"
    const phrase = document.getElementById("phrase")!
    const walkId = crypto.randomUUID()
    walkAndLabelElement(document.body, walkId, DEFAULT_CONFIG)
    await act(async () => {
      await translateNodes([phrase], walkId, false, DEFAULT_CONFIG)
      flushBatchedOperations()
    })
    expect(phrase.querySelector(`.${INLINE_CONTENT_CLASS}`)).toHaveTextContent("完整段落的译文。")
    expect(phrase.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toBeNull()
  })

  it("gives explicit site inline styles priority over paragraph layout", async () => {
    const { root } = await translate("<p id=\"source\"><span style=\"display:inline\">A complete paragraph with enough words.</span></p>", { forceInlineStyleSelectors: ["#source"] })
    expect(root.querySelector(`.${INLINE_CONTENT_CLASS}`)).toHaveTextContent("完整段落的译文。")
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toBeNull()
  })

  it("keeps an explicit block style above an inline conflict and flex layout", async () => {
    const { root } = await translate("<p id=\"source\" style=\"display:flex\"><span style=\"display:inline\">A complete paragraph with enough words.</span></p>", {
      forceBlockStyleSelectors: ["#source"],
      forceInlineStyleSelectors: ["#source"],
    })
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toHaveTextContent("完整段落的译文。")
  })

  it("hands the same block layout to a streaming request and the final renderer", async () => {
    const request: PageTranslationRequest = vi.fn(async (_text, typographyElement) => {
      expect(typographyElement?.tagName).toBe("SPAN")
      expect(getPendingTranslationLayout(typographyElement!)).toBe("block")
      return "完整段落的译文。"
    })
    const { root } = await translate("<p id=\"source\"><span style=\"display:inline\">A complete paragraph with enough words.</span></p>", {}, request)
    expect(request).toHaveBeenCalledOnce()
    expect(root.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toHaveTextContent("完整段落的译文。")
  })
})
