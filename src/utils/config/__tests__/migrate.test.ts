import { describe, expect, it } from "vitest"
import { CONFIG_VERSION } from "@/types/config/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { migrateStoredConfig, upgradeConfigVersion } from "../migrate"

/** A service as Plainly 1.0 stored it: the model is an object and options use the AI SDK's names. */
const legacyConfig = {
  ...DEFAULT_CONFIG,
  version: undefined,
  providersConfig: [
    {
      id: "openai-default",
      name: "OpenAI",
      enabled: true,
      provider: "openai",
      apiKey: "sk-old",
      model: { model: "gpt-5-mini", isCustomModel: false, customModel: null },
      providerOptions: { reasoningEffort: "minimal" },
    },
  ],
}

function withoutVersion(config: object): Record<string, unknown> {
  const { version: _, ...rest } = config as Record<string, unknown>
  return rest
}

describe("migrateStoredConfig", () => {
  it("migrates saved upstream CSS without changing credentials, prompts or preferences", () => {
    const customCSS = ".jiandao-translated-block-content[data-jiandao-custom-translation-style='custom'] { color: var(--jiandao-brand); }"
    const stored = {
      ...DEFAULT_CONFIG,
      version: 4,
      providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "kept-key" })),
      translate: {
        ...DEFAULT_CONFIG.translate,
        translationNodeStyle: { preset: "line", isCustom: false, customCSS },
      },
    }
    const result = migrateStoredConfig(stored)
    expect(result).toEqual({
      ok: true,
      config: {
        ...stored,
        version: CONFIG_VERSION,
        translate: {
          ...stored.translate,
          translationNodeStyle: {
            ...stored.translate.translationNodeStyle,
            customCSS: ".readomi-translated-block-content[data-readomi-custom-translation-style='custom'] { color: var(--readomi-brand); }",
          },
        },
      },
    })
    expect(stored.translate.translationNodeStyle.customCSS).toBe(customCSS)
  })

  it("preserves CSS unrelated to the upstream namespace when upgrading version 4", () => {
    const stored = {
      ...DEFAULT_CONFIG,
      version: 4,
      translate: {
        ...DEFAULT_CONFIG.translate,
        translationNodeStyle: { preset: "line", isCustom: true, customCSS: "[lang='zh'] { font-size: 16px; }" },
      },
    }
    expect(migrateStoredConfig(stored)).toEqual({ ok: true, config: { ...stored, version: CONFIG_VERSION } })
  })

  it("adds the default theme to version 3 without losing credentials or reading preferences", () => {
    const { appearance: _, ...old } = DEFAULT_CONFIG
    const stored = { ...old, version: 3, reading: { wordPrefixEmphasis: true }, providersConfig: old.providersConfig.map(p => ({ ...p, apiKey: "kept-key" })) }
    const result = migrateStoredConfig(stored)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.appearance).toEqual({ colorTheme: "terra" })
      expect(result.config.providersConfig).toEqual(stored.providersConfig)
      expect(result.config.reading.wordPrefixEmphasis).toBe(true)
      expect(result.config.version).toBe(CONFIG_VERSION)
    }
  })
  it("upgrades version 2 while preserving services, features and the page shortcut", () => {
    const old = { ...DEFAULT_CONFIG, version: 2, features: { hoverTranslation: true, videoSubtitles: true, subtitleMode: "translationOnly" } }
    expect(migrateStoredConfig(old)).toEqual({ ok: true, config: { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, ...old.features } } })
  })
  it("keeps a config at the current version", () => {
    expect(migrateStoredConfig(DEFAULT_CONFIG)).toEqual({ ok: true, config: DEFAULT_CONFIG })
  })

  it("reads a config without version, as 1.1.0 stored it, as version 1", () => {
    expect(migrateStoredConfig(withoutVersion(DEFAULT_CONFIG))).toEqual({ ok: true, config: DEFAULT_CONFIG })
  })

  it("reports a conflict for the 1.0 shape instead of converting it", () => {
    const result = migrateStoredConfig(withoutVersion(legacyConfig))
    expect(result.ok).toBe(false)
  })

  it("reports a conflict for a config from a newer build", () => {
    const result = migrateStoredConfig({ ...DEFAULT_CONFIG, version: CONFIG_VERSION + 1 })
    expect(result).toEqual({ ok: false, reason: `config version ${CONFIG_VERSION + 1} is newer than ${CONFIG_VERSION}` })
  })

  it("reports a conflict for a value that is not a config", () => {
    expect(migrateStoredConfig("config").ok).toBe(false)
    expect(migrateStoredConfig({ ...DEFAULT_CONFIG, version: "1" }).ok).toBe(false)
  })
})

describe("upgradeConfigVersion", () => {
  const migrations = {
    2: (config: Record<string, unknown>) => ({ ...config, steps: ["2"] }),
    3: (config: Record<string, unknown>) => ({ ...config, steps: [...config.steps as string[], "3"] }),
  }

  it("runs each step from the stored version to the target in order", () => {
    expect(upgradeConfigVersion({ version: 1 }, 3, migrations)).toEqual({ ok: true, config: { version: 3, steps: ["2", "3"] } })
    expect(upgradeConfigVersion({ version: 2, steps: [] }, 3, migrations)).toEqual({ ok: true, config: { version: 3, steps: ["3"] } })
  })

  it("fails when a step on the way is missing", () => {
    expect(upgradeConfigVersion({ version: 1 }, 4, migrations)).toEqual({ ok: false, reason: "no migration from config version 3 to 4" })
  })
})
