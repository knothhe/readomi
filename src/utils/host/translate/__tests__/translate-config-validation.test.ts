import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { validateTranslationConfigAndToast } from "../translate-text"

const { errorToast } = vi.hoisted(() => ({ errorToast: vi.fn() }))
vi.mock("@/components/toast", () => ({ toast: { error: errorToast } }))

beforeEach(() => vi.clearAllMocks())

describe("input translation service validation", () => {
  it("checks the assigned input service instead of an unconfigured shared service", () => {
    const input = { ...DEFAULT_CONFIG.providersConfig[0], id: "input", apiKey: "input-test-key" }
    const config = {
      ...DEFAULT_CONFIG,
      providersConfig: [...DEFAULT_CONFIG.providersConfig, input],
      translate: { ...DEFAULT_CONFIG.translate, modelProviders: { ...DEFAULT_CONFIG.translate.modelProviders, input: input.id } },
    }
    expect(validateTranslationConfigAndToast(config, "input")).toBe(true)
    expect(errorToast).not.toHaveBeenCalled()
    expect(validateTranslationConfigAndToast({ ...config, providersConfig: config.providersConfig.filter(p => p.id !== input.id) }, "input")).toBe(false)
  })

  it("rejects an input service without credentials even when the shared service is configured", () => {
    const shared = { ...DEFAULT_CONFIG.providersConfig[0], apiKey: "shared-test-key" }
    const input = { ...DEFAULT_CONFIG.providersConfig[0], id: "input" }
    const config = {
      ...DEFAULT_CONFIG,
      providersConfig: [shared, input],
      translate: { ...DEFAULT_CONFIG.translate, modelProviders: { ...DEFAULT_CONFIG.translate.modelProviders, input: input.id } },
    }
    expect(validateTranslationConfigAndToast(config, "input")).toBe(false)
    expect(errorToast).toHaveBeenCalledOnce()
    expect(validateTranslationConfigAndToast({ ...config, translate: { ...config.translate, modelProviders: { ...config.translate.modelProviders, input: null } } }, "input")).toBe(true)
  })
})
