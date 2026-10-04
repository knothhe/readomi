import type { PageTranslationManager } from "../page-translation"
import type { Config } from "@/types/config/config"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { handleTranslationModeChange } from "../handle-config-change"

function createMockConfig(mode: "bilingual" | "translationOnly"): Config {
  return { translate: { mode } } as Config
}

function createMockManager(isActive: boolean): PageTranslationManager {
  return {
    isActive,
    restart: vi.fn().mockResolvedValue(undefined),
  } as unknown as PageTranslationManager
}

describe("handleTranslationModeChange", () => {
  it("should trigger re-translation when mode changes and manager is active", () => {
    const manager = createMockManager(true)

    handleTranslationModeChange(
      createMockConfig("translationOnly"),
      createMockConfig("bilingual"),
      manager,
    )

    expect(manager.restart).toHaveBeenCalled()
  })

  it("should not trigger when mode stays the same", () => {
    const manager = createMockManager(true)

    handleTranslationModeChange(
      createMockConfig("bilingual"),
      createMockConfig("bilingual"),
      manager,
    )

    expect(manager.restart).not.toHaveBeenCalled()
  })

  it("should not trigger when manager is not active", () => {
    const manager = createMockManager(false)

    handleTranslationModeChange(
      createMockConfig("translationOnly"),
      createMockConfig("bilingual"),
      manager,
    )

    expect(manager.restart).not.toHaveBeenCalled()
  })

  it("preserves existing page translations when the selected service changes", () => {
    const manager = createMockManager(true)
    const nextProvider = { ...DEFAULT_CONFIG.providersConfig[0], id: "second-service", name: "Second service" }
    const previous = { ...DEFAULT_CONFIG, providersConfig: [...DEFAULT_CONFIG.providersConfig, nextProvider] }
    const next = { ...previous, translate: { ...previous.translate, providerId: nextProvider.id } }

    handleTranslationModeChange(next, previous, manager)

    expect(manager.restart).not.toHaveBeenCalled()
  })

  it("restarts an active page when a site rule is edited or disabled", () => {
    const manager = createMockManager(true)
    const previous = { ...createMockConfig("bilingual"), siteRules: { userRules: [], disabledBuiltInRules: [] } }
    const next = { ...previous, siteRules: { userRules: [], disabledBuiltInRules: ["twitter"] } }
    handleTranslationModeChange(next, previous, manager)
    expect(manager.restart).toHaveBeenCalledOnce()
  })
})
