// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { WebPagePromptContext } from "@/types/content"
import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { resolveProviderConfig } from "@/utils/constants/feature-providers"
import { onMessage } from "@/utils/message"
import { translateTextCore } from "../translate-text"
import { translateTextForPage } from "../translate-variants"

const providerConfig = resolveProviderConfig(DEFAULT_CONFIG, "translate")

const langConfig = { sourceCode: "eng", targetCode: "cmn", level: "intermediate" } as const

const basePageContext: WebPagePromptContext = {
  webTitle: "Release notes",
  webDescription: "Notes for the release",
  webContent: "Page body.",
  webSummary: "The release adds a new setting.",
}

async function saveTranslatePrompt(prompt: string) {
  const config: Config = {
    ...DEFAULT_CONFIG,
    translate: {
      ...DEFAULT_CONFIG.translate,
      customPromptsConfig: {
        promptId: "custom",
        patterns: [{ id: "custom", name: "Custom", systemPrompt: "Translate to {{targetLanguage}}.", prompt }],
      },
    },
  }
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
}

/** Runs a translation and returns the cache key that it sends to the background. */
async function captureCacheKey(translate: () => Promise<string>): Promise<string> {
  let cacheKey = ""
  const removeListener = onMessage("enqueueTranslateRequest", async (message) => {
    cacheKey = message.data.hash
    return { action: "translate", text: "translated", targetCode: "cmn" }
  })
  try {
    await translate()
  }
  finally {
    removeListener()
  }
  return cacheKey
}

async function cacheKeyFor(pageChanges: Partial<WebPagePromptContext>): Promise<string> {
  return captureCacheKey(() => translateTextCore({
    text: "The release adds a new setting.",
    langConfig,
    providerConfig,
    webPageContext: { ...basePageContext, ...pageChanges },
  }))
}

async function pageCacheKeyFor(path: string, pageBody: string, title = basePageContext.webTitle ?? "", summary = basePageContext.webSummary ?? ""): Promise<string> {
  window.history.pushState({}, "", path)
  document.title = title
  document.head.innerHTML = `<meta name="description" content="${pageBody}">`
  document.body.innerHTML = `<article><h1>${document.title}</h1><p>${pageBody}</p></article>`

  const removeSummaryListener = onMessage("getOrGenerateWebPageSummary", async () => summary)
  try {
    return await captureCacheKey(() => translateTextForPage("The release adds a new setting."))
  }
  finally {
    removeSummaryListener()
  }
}

describe("translation cache key", () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
  })

  it("isolates both language targets while ignoring the legacy manually selected source", async () => {
    const forLanguage = (language: typeof langConfig & { secondaryCode?: "eng" | "original" }) => captureCacheKey(() => translateTextCore({ text: "中文原文", langConfig: language, providerConfig }))
    const automatic = await forLanguage({ ...langConfig, secondaryCode: "eng" })
    const preserved = await forLanguage({ ...langConfig, secondaryCode: "original" })
    expect(preserved).not.toBe(automatic)
    const legacySource = await captureCacheKey(() => translateTextCore({ text: "中文原文", langConfig: { ...langConfig, sourceCode: "cmn", secondaryCode: "eng" }, providerConfig }))
    expect(legacySource).toBe(automatic)
    const otherPrimary = await captureCacheKey(() => translateTextCore({ text: "中文原文", langConfig: { ...langConfig, targetCode: "jpn", secondaryCode: "eng" }, providerConfig }))
    expect(otherPrimary).not.toBe(automatic)
  })

  it("keeps the supplied prompt snapshot even after the stored prompt changes", async () => {
    const customPromptsConfig = { promptId: "snapshot", patterns: [{ id: "snapshot", name: "Snapshot", systemPrompt: "Use earlier wording", prompt: "{{input}}" }] }
    const run = () => captureCacheKey(() => translateTextCore({ text: "A paragraph", langConfig, providerConfig, customPromptsConfig }))
    const firstKey = await run()
    await saveTranslatePrompt("Use newly saved wording: {{input}}")
    expect(await run()).toBe(firstKey)
  })

  it("user gets a cached translation: Given the default prompt, which does not use {{webDescription}} or {{webContent}}, and the AI content aware setting is on, When the user translates the same paragraph on two pages with different descriptions and content, Then both translations use one cache entry", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, {
      ...DEFAULT_CONFIG,
      translate: { ...DEFAULT_CONFIG.translate, enableAIContentAware: true },
    })

    const firstKey = await pageCacheKeyFor("/release-notes/first", "First page body.")
    const secondKey = await pageCacheKeyFor("/release-notes/second", "Second page body.")

    // The model receives the same request.
    expect(secondKey).toBe(firstKey)
  })

  it("reuses a custom-prompt translation when only unused description and content change", async () => {
    await saveTranslatePrompt("{{input}}")

    const firstKey = await cacheKeyFor({})
    const secondKey = await cacheKeyFor({
      webDescription: "Changes in the release",
      webContent: "Other page body.",
    })

    // The model receives the same request.
    expect(secondKey).toBe(firstKey)
  })

  it("reuses a custom-prompt translation when automatically attached page background changes", async () => {
    await saveTranslatePrompt("{{input}}")
    const firstKey = await cacheKeyFor({})
    const secondKey = await cacheKeyFor({ webSummary: "A different topic." })
    expect(secondKey).toBe(firstKey)
  })

  it("reuses a custom-prompt translation even when referenced page content changes", async () => {
    await saveTranslatePrompt("Page content: {{webContent}}\n\n{{input}}")
    const sharedStart = "Shared page text. ".repeat(100)

    const firstKey = await cacheKeyFor({ webContent: `${sharedStart} first ending` })
    const secondKey = await cacheKeyFor({ webContent: `${sharedStart} second ending` })

    expect(secondKey).toBe(firstKey)
  })

  it.each([
    ["title", { webTitle: "Changelog" }],
    ["summary", { webSummary: "The release removes an old setting." }],
    ["description", { webDescription: "A different description." }],
    ["content", { webContent: "A different article." }],
  ])("reuses a default-prompt translation when page %s changes", async (_field, pageChanges) => {
    const firstKey = await cacheKeyFor({})
    const secondKey = await cacheKeyFor(pageChanges)

    expect(secondKey).toBe(firstKey)
  })

  it.each([false, true])("reuses web text between X home and post details with AI content awareness set to %s", async (enableAIContentAware) => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, {
      ...DEFAULT_CONFIG,
      translate: { ...DEFAULT_CONFIG.translate, enableAIContentAware },
    })
    const home = await pageCacheKeyFor("/home", "A feed with several posts.", "Home / X", "A mixed feed.")
    const detail = await pageCacheKeyFor("/mattpocockuk/status/2107749763789578692", "A post with replies.", "Matt Pocock on X / X", "A software engineering post.")
    expect(detail).toBe(home)
  })

  it("ignores all page context values while still forwarding the actual context to translation requests", async () => {
    await saveTranslatePrompt("Title: {{webTitle}}\nDescription: {{webDescription}}\nContent: {{webContent}}\nSummary: {{webSummary}}\n{{input}}")
    const requests: { hash: string, context: WebPagePromptContext }[] = []
    const remove = onMessage("enqueueTranslateRequest", async ({ data }) => {
      requests.push({ hash: data.hash, context: { webTitle: data.webTitle, webDescription: data.webDescription, webContent: data.webContent, webSummary: data.webSummary } })
      return { action: "translate", text: "translated", targetCode: "cmn" }
    })
    const contexts: (WebPagePromptContext | undefined)[] = [
      undefined,
      basePageContext,
      { webTitle: "Home / X", webDescription: "New description", webContent: "Other content", webSummary: "Other summary" },
    ]
    try {
      for (const webPageContext of contexts)
        await translateTextCore({ text: "A paragraph", langConfig, providerConfig, webPageContext })
    }
    finally {
      remove()
    }
    expect(new Set(requests.map(request => request.hash)).size).toBe(1)
    expect(requests[1].context).toEqual(basePageContext)
    expect(requests[2].context).toEqual(contexts[2])
  })

  it("invalidates changes to active translation rules, including context-bearing template lines", async () => {
    await saveTranslatePrompt("Title: {{webTitle}}\n{{input}}")
    const firstKey = await cacheKeyFor({})
    await saveTranslatePrompt("Use title as background: {{webTitle}}\n{{input}}")
    expect(await cacheKeyFor({})).not.toBe(firstKey)
  })

  it("ignores prompt names and inactive patterns but isolates original text and service configuration", async () => {
    const active = { id: "active", name: "First name", systemPrompt: "Translate carefully", prompt: "{{input}}" }
    const run = (text: string, provider = providerConfig, patterns = [active]) => captureCacheKey(() => translateTextCore({
      text, langConfig, providerConfig: provider, customPromptsConfig: { promptId: "active", patterns },
    }))
    const firstKey = await run("First paragraph")
    expect(await run("First paragraph", providerConfig, [{ ...active, name: "Renamed" }, { ...active, id: "unused", prompt: "Other rules" }])).toBe(firstKey)
    expect(await run("Second paragraph")).not.toBe(firstKey)
    expect(await run("First paragraph", { ...providerConfig, model: "another-model" })).not.toBe(firstKey)
  })
})
