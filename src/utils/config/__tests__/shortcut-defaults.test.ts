import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { getLocalConfig } from "../storage"

function olderConfig(pageShortcut = "Alt+E") {
  const { modeShortcut: _, subtitlesShortcut: __, ...features } = DEFAULT_CONFIG.features
  return { ...DEFAULT_CONFIG, translate: { ...DEFAULT_CONFIG.translate, page: { shortcut: pageShortcut } }, features }
}

describe("shortcut defaults and older configurations", () => {
  beforeEach(() => fakeBrowser.reset())

  it("uses E, M and V for new configs and fills missing action shortcuts without writing stored data", async () => {
    expect(DEFAULT_CONFIG.translate.page.shortcut).toBe("Alt+E")
    expect(DEFAULT_CONFIG.features.modeShortcut).toBe("Alt+M")
    expect(DEFAULT_CONFIG.features.subtitlesShortcut).toBe("Alt+V")
    const stored = olderConfig()
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, stored)
    expect(await getLocalConfig()).toEqual(DEFAULT_CONFIG)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(stored)
  })

  it.each([
    ["", ""], ["Alt+K", "Alt+S"], ["", "Alt+S"], ["Alt+K", ""],
  ])("preserves explicitly saved mode %s and subtitle %s shortcuts", (modeShortcut, subtitlesShortcut) => {
    const config: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, modeShortcut, subtitlesShortcut } }
    expect(configSchema.parse(config)).toEqual(config)
  })

  it.each([
    ["Alt+M", "", "Alt+V"], ["Option+M", "", "Alt+V"], ["Alt+V", "Alt+M", ""],
  ])("keeps an existing page shortcut %s and leaves a conflicting newly added default empty", (pageShortcut, modeShortcut, subtitlesShortcut) => {
    const config = olderConfig(pageShortcut)
    const parsed = configSchema.parse(config)
    expect(parsed.translate.page.shortcut).toBe(pageShortcut)
    expect(parsed.features).toEqual({ ...config.features, modeShortcut, subtitlesShortcut })
    expect(parsed.providersConfig).toEqual(config.providersConfig)
    expect(parsed.language).toEqual(config.language)
  })

  it("lets an explicitly configured action keep a shortcut reserved by the other action's missing default", () => {
    const older = olderConfig()
    const modeReserved = configSchema.parse({ ...older, features: { ...older.features, subtitlesShortcut: "Alt+M" } })
    expect(modeReserved.features.modeShortcut).toBe("")
    expect(modeReserved.features.subtitlesShortcut).toBe("Alt+M")
    const subtitleReserved = configSchema.parse({ ...older, features: { ...older.features, modeShortcut: "Option+V" } })
    expect(subtitleReserved.features.modeShortcut).toBe("Option+V")
    expect(subtitleReserved.features.subtitlesShortcut).toBe("")
  })

  it("still rejects explicit duplicate or malformed shortcuts", () => {
    expect(configSchema.safeParse({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, modeShortcut: "Alt+E" } }).success).toBe(false)
    expect(configSchema.safeParse({ ...olderConfig(), features: { ...olderConfig().features, modeShortcut: null } }).success).toBe(false)
  })
})
