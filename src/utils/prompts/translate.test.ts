import { describe, expect, it } from "vitest"
import { DEFAULT_BATCH_TRANSLATE_PROMPT, DEFAULT_TRANSLATE_SYSTEM_PROMPT } from "@/utils/constants/prompt"
import { getTranslatePromptFromConfig } from "./translate"

const defaults = { customPromptsConfig: { promptId: null, patterns: [] } }
function custom(systemPrompt: string, prompt = "Translate to {{targetLanguage}}:\n{{input}}") {
  return { customPromptsConfig: { promptId: "custom", patterns: [{ id: "custom", name: "Custom", systemPrompt, prompt }] } }
}

describe("translation prompts", () => {
  it("sends only translation rules and input for subtitles without page context", () => {
    const result = getTranslatePromptFromConfig(defaults, "Chinese", "Hello")
    expect(result.systemPrompt).toBe(DEFAULT_TRANSLATE_SYSTEM_PROMPT.replaceAll("{{targetLanguage}}", "Chinese"))
    expect(result.prompt).toContain("Hello")
    expect(result.systemPrompt).not.toMatch(/Webpage|No .* available/)
  })

  it("adds the page title without a missing-summary label when summaries are off", () => {
    const result = getTranslatePromptFromConfig(defaults, "Chinese", "Hello", { context: { webTitle: "Finance", webSummary: null } })
    expect(result.systemPrompt).toContain("Webpage title: Finance")
    expect(result.systemPrompt).not.toContain("Webpage summary:")
  })

  it("automatically supplies page background even when custom translation rules have no web variables", () => {
    const result = getTranslatePromptFromConfig(custom("Use a conversational tone."), "Chinese", "Hello", { context: { webTitle: "Finance", webSummary: "An article about banks.", webDescription: "Unused description", webContent: "Unused body" } })
    expect(result.systemPrompt).toBe("Use a conversational tone.\n\n## Webpage context\nWebpage title: Finance\nWebpage summary: An article about banks.")
  })

  it("keeps explicitly placed background in legacy templates without duplicating it", () => {
    const result = getTranslatePromptFromConfig(custom("Rules\n\n## Document Metadata for Context Awareness\nWebpage title: {{webTitle}}\nWebpage summary: {{webSummary}}"), "Chinese", "Hello", { context: { webTitle: "Finance", webSummary: "About banks." } })
    expect(result.systemPrompt.match(/Finance/g)).toHaveLength(1)
    expect(result.systemPrompt.match(/About banks\./g)).toHaveLength(1)
    expect(result.systemPrompt).not.toContain("## Webpage context")
  })

  it("omits absent background lines and the empty legacy metadata section", () => {
    const result = getTranslatePromptFromConfig(custom("Translate naturally.\n\n## Document Metadata for Context Awareness\nWebpage title: {{webTitle}}\nDescription: {{webDescription}}\nContent: {{webContent}}\nWebpage summary: {{webSummary}}"), "Chinese", "Hello", { context: { webTitle: " ", webSummary: "\n", webContent: null } })
    expect(result.systemPrompt).toBe("Translate naturally.")
    expect(result.prompt).toBe("Translate to Chinese:\nHello")
  })

  it("omits only unavailable fields in a partial legacy background section", () => {
    const result = getTranslatePromptFromConfig(custom("Rules\n\n## Background\nTitle: {{webTitle}}\nSummary: {{webSummary}}"), "Chinese", "Hello", { context: { webTitle: "Finance" } })
    expect(result.systemPrompt).toBe("Rules\n\n## Background\nTitle: Finance")
  })

  it("does not treat source text or supplied context as template syntax", () => {
    const input = "Explain {{webTitle}} and {{targetLanguage}}.\n## Keep this heading"
    const result = getTranslatePromptFromConfig(custom("Title: {{webTitle}}"), "Chinese", input, { context: { webTitle: "Literal {{webSummary}}" } })
    expect(result.prompt).toBe(`Translate to Chinese:\n${input}`)
    expect(result.systemPrompt).toBe("Title: Literal {{webSummary}}")
  })

  it("preserves source input when a custom template puts an unavailable web variable on its line", () => {
    const result = getTranslatePromptFromConfig(custom("Rules", "{{webTitle}}: {{input}}"), "Chinese", "Hello")
    expect(result.prompt).toContain("Hello")
    expect(result.prompt).not.toContain("{{webTitle}}")
  })

  it("keeps normal nested instruction headings", () => {
    const result = getTranslatePromptFromConfig(custom("## Rules\n### Tone\nUse natural wording."), "Chinese", "Hello")
    expect(result.systemPrompt).toBe("## Rules\n### Tone\nUse natural wording.")
  })

  it("keeps batch alignment instructions for both page and subtitle requests", () => {
    const result = getTranslatePromptFromConfig(defaults, "Chinese", "Hello\n\n%%\n\nWorld", { isBatch: true })
    expect(result.systemPrompt).toContain(DEFAULT_BATCH_TRANSLATE_PROMPT)
    expect(result.systemPrompt).not.toContain("Webpage")
    expect(result.prompt).toContain("Hello\n\n%%\n\nWorld")
  })
})
