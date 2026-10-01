import type { Config } from "@/types/config/config"
import { beforeEach, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { initializeConfig } from "../init"

beforeEach(() => {
  fakeBrowser.reset()
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
