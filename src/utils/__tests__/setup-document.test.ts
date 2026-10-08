import type { Config } from "@/types/config/config"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import {
  applySetupDocument,
  describeSetupDocument,
  exportSetupDocument,
  isMaskedApiKey,
  maskApiKey,
  parseSetupDocument,
  SetupDocumentError,
  stringifySetupDocument,
} from "../setup-document"

function configWithOpenAIKey(apiKey: string): Config {
  return {
    ...DEFAULT_CONFIG,
    providersConfig: DEFAULT_CONFIG.providersConfig.map(provider =>
      provider.id === "openai-default" ? { ...provider, apiKey } : provider,
    ),
  }
}

describe("parseSetupDocument", () => {
  it("accepts the minimal document for an official service", () => {
    const result = parseSetupDocument(`{"type":"deepseek","apiKey":"sk-abc","model":"deepseek-flash"}`)
    expect(result.ok).toBe(true)
  })

  it("accepts every official service and a compatible one with its own wire format", () => {
    for (const type of ["openai", "anthropic", "gemini", "deepseek"]) {
      expect(parseSetupDocument(JSON.stringify({ type, apiKey: "k", model: "m" })).ok).toBe(true)
    }
    const xai = parseSetupDocument(`{"type":"openai-compatible","api":"openai-responses","apiKey":"k","model":"grok-4.7","baseURL":"https://api.x.ai/v1"}`)
    expect(xai.ok).toBe(true)
  })

  it("reports each problem with its JSON path so the agent can fix it", () => {
    const result = parseSetupDocument(`{"type":"openai-compatible","apiKey":"local","model":"qwen3:8b"}`)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toContain("baseURL: baseURL is required")

    const noModel = parseSetupDocument(`{"type":"openai","apiKey":"sk-abc"}`)
    expect(noModel.ok).toBe(false)
    if (!noModel.ok)
      expect(noModel.error).toMatch(/^model:/)
  })

  it("covers the service only: languages, display and prompt are rejected", () => {
    const result = parseSetupDocument(`{"type":"deepseek","apiKey":"sk-abc","model":"deepseek-flash","targetLanguage":"cmn","prompt":null}`)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("targetLanguage")
      expect(result.error).toContain("prompt")
    }
  })

  it("rejects unknown fields instead of ignoring them", () => {
    const result = parseSetupDocument(`{"type":"openai","apiKey":"sk-abc","model":"gpt-6-luna","providerOptions":{}}`)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toContain("providerOptions")
  })

  it("rejects text that is not JSON", () => {
    const result = parseSetupDocument("sk-abcdef")
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toMatch(/^Not valid JSON/)
  })
})

describe("applySetupDocument", () => {
  it("adds a new service and makes it the translation service, leaving other settings alone", () => {
    const parsed = parseSetupDocument(JSON.stringify({
      type: "openai-compatible",
      name: "Ollama",
      apiKey: "local",
      model: "qwen3:8b",
      baseURL: "http://localhost:11434/v1/",
      body: { reasoning_effort: "none" },
    }))
    if (!parsed.ok)
      throw new Error(parsed.error)

    const { config, providerId, replaced, keyReused } = applySetupDocument(DEFAULT_CONFIG, parsed.document)
    const added = config.providersConfig.find(p => p.id === providerId)

    expect(replaced).toBe(false)
    expect(keyReused).toBe(false)
    expect(config.providersConfig).toHaveLength(DEFAULT_CONFIG.providersConfig.length + 1)
    expect(added).toEqual({
      id: providerId,
      name: "Ollama",
      enabled: true,
      provider: "openai-compatible",
      apiKey: "local",
      baseURL: "http://localhost:11434/v1",
      model: "qwen3:8b",
      body: { reasoning_effort: "none" },
    })
    expect(config.translate).toEqual({ ...DEFAULT_CONFIG.translate, providerId })
    expect(config.language).toEqual(DEFAULT_CONFIG.language)
  })

  it("drops the previous connection check of a replaced service", () => {
    const stored = configWithOpenAIKey("sk-old-key")
    stored.providersConfig = stored.providersConfig.map(p => ({ ...p, connectionCheck: { ok: true, checkedAt: 1 } }))
    const parsed = parseSetupDocument(`{"type":"openai","apiKey":"sk-new-key","model":"gpt-6-luna"}`)
    if (!parsed.ok)
      throw new Error(parsed.error)

    const { config, providerId } = applySetupDocument(stored, parsed.document)
    expect(config.providersConfig.find(p => p.id === providerId)).not.toHaveProperty("connectionCheck")
  })

  it("replaces the stored service with the same type and endpoint and keeps the others", () => {
    const parsed = parseSetupDocument(`{"type":"openai","apiKey":"sk-new-key","model":"gpt-6-luna","body":{"reasoning":{"effort":"none"}}}`)
    if (!parsed.ok)
      throw new Error(parsed.error)

    const stored: Config = { ...configWithOpenAIKey("sk-old-key") }
    stored.providersConfig = [...stored.providersConfig, { id: "claude", name: "Claude", enabled: true, provider: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5" }]

    const { config, providerId, replaced } = applySetupDocument(stored, parsed.document)

    expect(replaced).toBe(true)
    expect(providerId).toBe("openai-default")
    expect(config.providersConfig).toHaveLength(stored.providersConfig.length)
    expect(config.providersConfig.find(p => p.id === "openai-default")).toMatchObject({
      apiKey: "sk-new-key",
      model: "gpt-6-luna",
      body: { reasoning: { effort: "none" } },
    })
    expect(config.providersConfig.find(p => p.id === "claude")).toEqual(stored.providersConfig[1])
  })

  it("keeps the stored key when the document carries the masked key from an export", () => {
    const stored = configWithOpenAIKey("sk-proj-1234567890a9f2")
    const exported = exportSetupDocument(stored)
    if (!exported)
      throw new Error("export failed")
    expect(exported.apiKey).toBe("sk-proj-…a9f2")

    const edited = { ...exported, model: "gpt-5-mini" }
    const { config, keyReused } = applySetupDocument(stored, edited)

    expect(keyReused).toBe(true)
    expect(config.providersConfig.find(p => p.id === "openai-default")).toMatchObject({
      apiKey: "sk-proj-1234567890a9f2",
      model: "gpt-5-mini",
    })
  })

  it("refuses a document without a usable key when no stored service matches", () => {
    const parsed = parseSetupDocument(`{"type":"deepseek","apiKey":"sk-…a9f2","model":"deepseek-flash"}`)
    if (!parsed.ok)
      throw new Error(parsed.error)

    expect(() => applySetupDocument(DEFAULT_CONFIG, parsed.document)).toThrow(SetupDocumentError)
  })

  it("treats a relay with its own base URL as a different service from the official API", () => {
    const parsed = parseSetupDocument(`{"type":"openai","apiKey":"sk-relay","model":"gpt-6-luna","baseURL":"https://relay.example.com/v1"}`)
    if (!parsed.ok)
      throw new Error(parsed.error)

    const { config, replaced } = applySetupDocument(configWithOpenAIKey("sk-official"), parsed.document)

    expect(replaced).toBe(false)
    expect(config.providersConfig.filter(p => p.provider === "openai")).toHaveLength(2)
    expect(config.providersConfig.find(p => p.id === "openai-default")?.apiKey).toBe("sk-official")
  })

  it("adds another account at the same endpoint without overwriting or selecting it", () => {
    const stored = configWithOpenAIKey("sk-first-account")
    const result = applySetupDocument(stored, { type: "openai", apiKey: "sk-second-account", model: "gpt-6-sol" }, { mode: "add" })
    expect(result.replaced).toBe(false)
    expect(result.config.providersConfig).toHaveLength(2)
    expect(result.config.providersConfig[0]).toEqual(stored.providersConfig[0])
    expect(result.config.providersConfig[1]).toMatchObject({ name: "OpenAI 1", apiKey: "sk-second-account", model: "gpt-6-sol" })
    expect(result.config.translate.providerId).toBe(stored.translate.providerId)
  })

  it("requires a new account's own key even when another account uses the same endpoint", () => {
    const stored = configWithOpenAIKey("sk-existing-key")
    const document = { type: "openai" as const, apiKey: "sk-…-key", model: "gpt-6-sol" }
    expect(describeSetupDocument(stored, document, { mode: "add" }).keyStatus).toBe("missing")
    expect(() => applySetupDocument(stored, document, { mode: "add" })).toThrow(SetupDocumentError)
  })

  it("replaces the untouched initial placeholder and activates the first configured service", () => {
    const result = applySetupDocument(DEFAULT_CONFIG, { type: "deepseek", apiKey: "sk-first", model: "deepseek-chat" }, { mode: "add" })
    expect(result.config.providersConfig).toHaveLength(1)
    expect(result.config.providersConfig[0]).toMatchObject({ id: "openai-default", name: "DeepSeek", provider: "deepseek" })
    expect(result.config.translate.providerId).toBe(result.providerId)
  })

  it("edits an inactive identity and reuses only its own key", () => {
    const stored: Config = {
      ...configWithOpenAIKey("sk-active"),
      providersConfig: [
        ...configWithOpenAIKey("sk-active").providersConfig,
        { id: "second-account", name: "Second account", enabled: true, provider: "openai", apiKey: "sk-second", model: "gpt-6-sol" },
      ],
    }
    const exported = exportSetupDocument(stored, "second-account")!
    expect(exported.apiKey).toBe("sk-…cond")
    const document = { ...exported, model: "gpt-6-luna" }
    const result = applySetupDocument(stored, document, { mode: "edit", providerId: "second-account" })
    expect(result.providerId).toBe("second-account")
    expect(result.keyReused).toBe(true)
    expect(result.config.providersConfig[1]).toMatchObject({ apiKey: "sk-second", model: "gpt-6-luna" })
    expect(result.config.providersConfig[0]).toEqual(stored.providersConfig[0])
    expect(result.config.translate).toEqual(stored.translate)
    expect(describeSetupDocument(stored, document, { mode: "edit", providerId: "second-account" }).keyStatus).toBe("reused")
  })

  it("requires a new key when an explicit edit changes the endpoint or service type", () => {
    const stored = configWithOpenAIKey("sk-current-key")
    const exported = exportSetupDocument(stored)!
    const options = { mode: "edit" as const, providerId: "openai-default" }
    const changed = { ...exported, baseURL: "https://different.example/v1" }
    expect(describeSetupDocument(stored, changed, options).keyStatus).toBe("missing")
    expect(() => applySetupDocument(stored, changed, options)).toThrow(SetupDocumentError)
    expect(() => applySetupDocument(stored, { ...changed, apiKey: undefined }, options)).toThrow(SetupDocumentError)
    expect(() => applySetupDocument(stored, { ...exported, type: "deepseek" }, options)).toThrow(SetupDocumentError)
    const result = applySetupDocument(stored, { ...changed, apiKey: "sk-new-endpoint-key" }, options)
    expect(result.providerId).toBe("openai-default")
    expect(result.config.providersConfig[0]).toMatchObject({ apiKey: "sk-new-endpoint-key", baseURL: changed.baseURL })
  })

  it("refuses to recreate an edited service that was removed while its editor was open", () => {
    expect(() => applySetupDocument(configWithOpenAIKey("sk-current"), { type: "openai", apiKey: "sk-key", model: "gpt-6-sol" }, { mode: "edit", providerId: "removed" }))
      .toThrow("no longer exists")
  })
})

describe("describeSetupDocument", () => {
  it("tells the reader where page text will go and whether the key is new", () => {
    const parsed = parseSetupDocument(`{"type":"deepseek","apiKey":"sk-abc","model":"deepseek-flash","body":{"thinking":{"type":"disabled"}}}`)
    if (!parsed.ok)
      throw new Error(parsed.error)

    expect(describeSetupDocument(DEFAULT_CONFIG, parsed.document)).toEqual({
      type: "deepseek",
      api: "openai-chat",
      providerName: "DeepSeek",
      modelId: "deepseek-flash",
      host: "api.deepseek.com",
      keyStatus: "new",
      thinkingOff: true,
      replaces: false,
    })
  })

  it("recognizes the thinking switch of each wire format", () => {
    const cases: Array<[Record<string, unknown>, boolean]> = [
      [{ type: "openai", body: { reasoning: { effort: "none" } } }, true],
      [{ type: "openai", body: { reasoning: { effort: "high" } } }, false],
      [{ type: "anthropic", body: { thinking: { type: "disabled" } } }, true],
      [{ type: "anthropic", body: { output_config: { effort: "low" } } }, true],
      [{ type: "gemini", body: { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } } }, true],
      [{ type: "gemini", body: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } }, true],
      [{ type: "openai-compatible", baseURL: "http://localhost:1234/v1", body: { enable_thinking: false } }, true],
    ]
    for (const [provider, expected] of cases) {
      const parsed = parseSetupDocument(JSON.stringify({ apiKey: "k", model: "m", ...provider }))
      if (!parsed.ok)
        throw new Error(parsed.error)
      expect(describeSetupDocument(DEFAULT_CONFIG, parsed.document).thinkingOff, JSON.stringify(provider)).toBe(expected)
    }
  })

  it("uses the base URL host for custom endpoints and reports a missing key", () => {
    const parsed = parseSetupDocument(`{"type":"openai-compatible","model":"qwen3:8b","baseURL":"http://localhost:11434/v1"}`)
    if (!parsed.ok)
      throw new Error(parsed.error)

    const preview = describeSetupDocument(DEFAULT_CONFIG, parsed.document)
    expect(preview.host).toBe("localhost:11434")
    expect(preview.keyStatus).toBe("missing")
    expect(preview.thinkingOff).toBeNull()
  })
})

describe("services without API keys", () => {
  const document = { type: "openai-compatible" as const, noApiKey: true, model: "qwen3:8b", baseURL: "http://localhost:11434/v1" }

  it("adds and exports a local service without a placeholder key", () => {
    const parsed = parseSetupDocument(JSON.stringify(document))
    expect(parsed.ok).toBe(true)
    expect(describeSetupDocument(DEFAULT_CONFIG, document).keyStatus).toBe("none")
    const result = applySetupDocument(DEFAULT_CONFIG, document, { mode: "add" })
    expect(result.config.providersConfig[0]).toMatchObject({ noApiKey: true, model: document.model })
    expect(result.config.providersConfig[0]).not.toHaveProperty("apiKey")
    expect(result.keyReused).toBe(false)
    expect(exportSetupDocument(result.config)).toEqual(document)
  })

  it("removes a stored key when switching authentication off and requires a key when switching it back on", () => {
    const stored = configWithOpenAIKey("sk-current")
    const result = applySetupDocument(stored, { type: "openai", noApiKey: true, apiKey: "sk-…rent", model: "m" }, { mode: "edit", providerId: "openai-default" })
    expect(result.config.providersConfig[0]).not.toHaveProperty("apiKey")
    expect(result.config.providersConfig[0].noApiKey).toBe(true)
    expect(() => applySetupDocument(result.config, { type: "openai", model: "m" }, { mode: "edit", providerId: "openai-default" })).toThrow(SetupDocumentError)
  })
})

describe("api key masking", () => {
  it("keeps the prefix and the last four characters", () => {
    expect(maskApiKey("sk-abcdefghijkl")).toBe("sk-…ijkl")
    expect(maskApiKey("sk-ant-abcdefghijkl")).toBe("sk-ant-…ijkl")
    expect(maskApiKey("token12345")).toBe("…2345")
  })

  it("recognizes masked keys written with the ellipsis or three dots", () => {
    expect(isMaskedApiKey("sk-…ijkl")).toBe(true)
    expect(isMaskedApiKey("sk-...ijkl")).toBe(true)
    expect(isMaskedApiKey("sk-abcdefghijkl")).toBe(false)
  })
})

describe("exportSetupDocument", () => {
  it("round-trips through parse with the masked key", () => {
    const exported = exportSetupDocument(configWithOpenAIKey("sk-abcdefghijkl"))
    if (!exported)
      throw new Error("export failed")

    const reparsed = parseSetupDocument(stringifySetupDocument(exported))
    expect(reparsed.ok).toBe(true)
    // The default name is left out, so the document holds only what the reader or agent chose.
    expect(exported).toEqual({ type: "openai", apiKey: "sk-…ijkl", model: "gpt-6-luna" })
  })
})
