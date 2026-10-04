import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { exportConfigBackup, parseConfigBackup } from "../backup"
import { getLocalConfig } from "../storage"

describe("translation language configuration compatibility", () => {
  beforeEach(() => fakeBrowser.reset())

  it("uses Simplified Chinese and English for new configurations", () => {
    expect(DEFAULT_CONFIG.language).toMatchObject({ targetCode: "cmn", secondaryCode: "eng" })
  })

  it("adds the second language to older configs without resetting language or provider preferences", async () => {
    const { secondaryCode: _, ...olderLanguage } = DEFAULT_CONFIG.language
    const older = {
      ...DEFAULT_CONFIG,
      language: { ...olderLanguage, sourceCode: "fra", targetCode: "jpn", level: "advanced" },
      providersConfig: DEFAULT_CONFIG.providersConfig.map(provider => ({ ...provider, apiKey: "existing-key", headers: { "X-Existing": "keep" } })),
      reading: { wordPrefixEmphasis: true },
    }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, older)
    const loaded = await getLocalConfig()
    if (!loaded)
      throw new Error("An existing language configuration must load successfully")
    expect(loaded.language).toEqual({ ...older.language, secondaryCode: "eng" })
    expect(loaded.providersConfig).toEqual(older.providersConfig)
    expect(loaded.reading).toEqual(older.reading)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(older)
  })

  it.each(["original", "cmn", "cmn-Hant", "arb"] as const)("round trips the %s second-language preference in backups", (secondaryCode) => {
    const config = { ...DEFAULT_CONFIG, language: { ...DEFAULT_CONFIG.language, secondaryCode } }
    expect(parseConfigBackup(exportConfigBackup(config)).language).toEqual(config.language)
  })

  it("accepts same-language choices and rejects unsupported saved second-language values", () => {
    expect(configSchema.safeParse({ ...DEFAULT_CONFIG, language: { ...DEFAULT_CONFIG.language, secondaryCode: "cmn" } }).success).toBe(true)
    expect(configSchema.safeParse({ ...DEFAULT_CONFIG, language: { ...DEFAULT_CONFIG.language, secondaryCode: "unknown" } }).success).toBe(false)
  })
})
