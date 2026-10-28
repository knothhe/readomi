import type { SiteRuleDocument } from "@/utils/site-rules/document"
import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { removeProvider, selectProvider } from "@/utils/service-management"
import { siteRuleBaseFingerprint } from "@/utils/site-rules/document"
import { isProviderInUse, translationProvider } from "@/utils/translation-models"

const first = { ...DEFAULT_CONFIG.providersConfig[0], apiKey: "test-key", model: "page-model" }
const hover = { ...first, id: "hover", name: "Hover", model: "hover-model" }
const video = { ...first, id: "video", name: "Video", model: "video-model" }
const configured = { ...DEFAULT_CONFIG, providersConfig: [first, hover, video] }

describe("translation model assignments", () => {
  it("keeps older configs on the current service without changing credentials", () => {
    const { modelProviders: _, ...translate } = configured.translate
    const parsed = configSchema.parse({ ...configured, translate })
    expect(parsed.translate.modelProviders).toEqual({ page: null, hover: null, video: null, input: null })
    for (const task of ["page", "hover", "video", "input"] as const)
      expect(translationProvider(parsed, task)).toEqual(first)
    expect(parsed.providersConfig).toEqual(configured.providersConfig)
  })

  it("routes each task independently and preserves fixed selections when the current service changes", () => {
    const config = configSchema.parse({ ...configured, translate: { ...configured.translate, modelProviders: { page: first.id, hover: hover.id, video: null, input: null } } })
    const next = selectProvider(config, video.id)
    expect(translationProvider(next, "page")).toEqual(first)
    expect(translationProvider(next, "hover")).toEqual(hover)
    expect(translationProvider(next, "video")).toEqual(video)
    expect(configSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next)
  })

  it("adds a shared input model to existing task assignments and preserves a fixed input selection", () => {
    const older = { ...configured, translate: { ...configured.translate, modelProviders: { page: first.id, hover: hover.id, video: null } } }
    const parsed = configSchema.parse(older)
    expect(parsed.translate.modelProviders.input).toBeNull()
    expect(translationProvider(parsed, "input")).toEqual(first)
    const selected = { ...parsed, translate: { ...parsed.translate, modelProviders: { ...parsed.translate.modelProviders, input: hover.id } } }
    const next = selectProvider(selected, video.id)
    expect(translationProvider(next, "input")).toEqual(hover)
    expect(() => removeProvider(next, hover.id)).toThrow()
    expect(configSchema.safeParse({ ...selected, providersConfig: [first, video] }).success).toBe(false)
  })

  it("rejects missing and disabled assigned services", () => {
    for (const id of ["missing", hover.id]) {
      const result = configSchema.safeParse({ ...configured, providersConfig: [first, { ...hover, enabled: false }], translate: { ...configured.translate, modelProviders: { page: null, hover: id, video: null, input: null } } })
      expect(result.success).toBe(false)
      if (!result.success)
        expect(result.error.issues.some(issue => issue.path.join(".") === "translate.modelProviders.hover")).toBe(true)
    }
  })

  it("protects a service assigned to a feature and allows removal after reassignment", () => {
    const config = { ...configured, translate: { ...configured.translate, modelProviders: { page: null, hover: hover.id, video: null, input: null } } }
    expect(isProviderInUse(config, hover.id)).toBe(true)
    expect(() => removeProvider(config, hover.id)).toThrow()
    const released = { ...config, translate: { ...config.translate, modelProviders: { ...config.translate.modelProviders, hover: null } } }
    expect(removeProvider(released, hover.id).providersConfig).toEqual([first, video])
  })
})

const ruleDocument: SiteRuleDocument = { format: "readomi-site-rule", version: 1, site: { hosts: ["example.com"] }, changes: [{ action: "upsert", rule: { id: "example", matches: "example.com" } }] }
describe("site rule preview model consistency", () => {
  it.each(["page", "hover"] as const)("invalidates the preview after the %s model changes", async (task) => {
    const fingerprint = await siteRuleBaseFingerprint(configured, ruleDocument)
    const next = { ...configured, translate: { ...configured.translate, modelProviders: { ...configured.translate.modelProviders, [task]: hover.id } } }
    expect(await siteRuleBaseFingerprint(next, ruleDocument)).not.toBe(fingerprint)
  })
  it("keeps the preview valid when unrelated default and video models change", async () => {
    const config = { ...configured, translate: { ...configured.translate, modelProviders: { page: first.id, hover: hover.id, video: null, input: null } } }
    const fingerprint = await siteRuleBaseFingerprint(config, ruleDocument)
    const next = { ...config, translate: { ...config.translate, providerId: video.id, modelProviders: { ...config.translate.modelProviders, video: video.id } } }
    expect(await siteRuleBaseFingerprint(next, ruleDocument)).toBe(fingerprint)
  })
})
