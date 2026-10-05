import type { Config } from "@/types/config/config"
import { beforeEach, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { initializeConfig } from "../init"

beforeEach(() => {
  fakeBrowser.reset()
})

it("defaults legacy configs to visible video controls while preserving existing preferences", () => {
  const { videoControls: _videoControls, ...features } = DEFAULT_CONFIG.features
  const legacy = { ...DEFAULT_CONFIG, features: { ...features, videoSubtitles: true } }
  expect(configSchema.parse(legacy)).toEqual({ ...legacy, features: { ...legacy.features, videoControls: true } })
})

it("keeps reading preferences and other settings when the background initializes", async () => {
  const stored: Config = {
    ...DEFAULT_CONFIG,
    language: { ...DEFAULT_CONFIG.language, targetCode: "jpn" },
    reading: { wordPrefixEmphasis: true },
  }
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, stored)

  await initializeConfig()

  expect(await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)).toEqual(stored)
})
