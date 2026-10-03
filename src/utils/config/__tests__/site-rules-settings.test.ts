import { expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

it("adds site rules defaults to legacy config without changing existing preferences", () => {
  const { siteRules: _siteRules, ...legacy } = DEFAULT_CONFIG
  const migrated = configSchema.parse({ ...legacy, language: { ...legacy.language, targetCode: "jpn" } })
  expect(migrated.siteRules).toEqual({ userRules: [], disabledBuiltInRules: [] })
  expect(migrated.language.targetCode).toBe("jpn")
  expect(migrated.translate).toEqual(legacy.translate)
  expect(migrated.providersConfig).toEqual(legacy.providersConfig)
})

it("keeps custom rules and disabled built-ins when config is exported and parsed again", () => {
  const config = {
    ...DEFAULT_CONFIG,
    siteRules: {
      disabledBuiltInRules: ["twitter"],
      userRules: [{ "id": "example", "matches": "example.com", "excludeSelectors.remove": ["footer"], "minWords": 1 }],
    },
  }
  expect(configSchema.parse(JSON.parse(JSON.stringify(config))).siteRules).toEqual(config.siteRules)
})
