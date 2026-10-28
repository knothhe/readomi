import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { getHostConfig } from "@/utils/site-rules/preview-config"
import { translateTextCore } from "../translate-text"
import { translateTextForInput, translateTextForPage, translateTextForPageTitle } from "../translate-variants"

vi.mock("@/utils/site-rules/preview-config", () => ({ getHostConfig: vi.fn() }))
vi.mock("../translate-text", () => ({ translateTextCore: vi.fn(async () => "translated") }))
vi.mock("../webpage-context", () => ({ getOrCreateWebPageContext: vi.fn(async () => undefined) }))

const base = { ...DEFAULT_CONFIG.providersConfig[0], apiKey: "test-key" }
const providers = [base, { ...base, id: "page", model: "page-model" }, { ...base, id: "hover", model: "hover-model" }, { ...base, id: "video", model: "video-model" }]
const config = { ...DEFAULT_CONFIG, providersConfig: providers, translate: { ...DEFAULT_CONFIG.translate, modelProviders: { page: "page", hover: "hover", video: "video", input: null } } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getHostConfig).mockResolvedValue(config)
})

describe("requests use their task's model", () => {
  it("uses the page model for paragraphs and the page title", async () => {
    await translateTextForPage("Page text")
    await translateTextForPageTitle("Page title")
    expect(vi.mocked(translateTextCore).mock.calls.map(([options]) => options.providerConfig.model)).toEqual(["page-model", "page-model"])
  })
  it("uses the hover model for both streaming and complete responses", async () => {
    const onPartial = vi.fn()
    await translateTextForPage("Hover text", { task: "hover", onPartial })
    await translateTextForPage("Hover text", { task: "hover" })
    expect(vi.mocked(translateTextCore).mock.calls.map(([options]) => options.providerConfig.model)).toEqual(["hover-model", "hover-model"])
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ onPartial }))
  })
  it("retains the existing shared service for input translation", async () => {
    await translateTextForInput("Typed text", config)
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ providerConfig: base }))
  })
  it("uses the independent input model without page context", async () => {
    const selected = { ...config, translate: { ...config.translate, modelProviders: { ...config.translate.modelProviders, input: "hover" } } }
    await translateTextForInput("Typed text", selected)
    expect(translateTextCore).toHaveBeenCalledWith(expect.objectContaining({ providerConfig: providers[2], extraHashTags: ["inputTranslation"] }))
    expect(vi.mocked(translateTextCore).mock.calls[0][0]).not.toHaveProperty("webPageContext")
  })
})
