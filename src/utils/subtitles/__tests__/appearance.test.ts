import { describe, expect, it } from "vitest"
import { storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { subtitleStyleSchema } from "@/types/config/subtitle-style"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { resolveSubtitlePosition, saveSubtitleStyle } from "../appearance"

describe("subtitle appearance configuration", () => {
  it("keeps a 2% bottom inset and accepts YouTube's computed edge without moving custom positions", () => {
    const video = { width: 640, height: 360 }
    const caption = { width: 200, height: 60 }
    const bottom = DEFAULT_CONFIG.features.subtitleStyle.position
    expect(resolveSubtitlePosition(bottom, video, caption).y / 100 * video.height).toBeCloseTo(352.8)
    expect(resolveSubtitlePosition(bottom, video, caption, 282.8).y / 100 * video.height).toBeCloseTo(282.8)
    expect(resolveSubtitlePosition(bottom, { width: 1920, height: 1080 }, caption).y / 100 * 1080).toBeCloseTo(1058.4)
    expect(resolveSubtitlePosition(bottom, { width: 320, height: 180 }, caption).y / 100 * 180).toBeCloseTo(176.4)
    expect(resolveSubtitlePosition({ x: 60, y: 65 }, video, caption, 282.8)).toEqual({ x: 60, y: 65 })
  })
  it("adds defaults to existing configurations without losing the user's translation service or mode", () => {
    const old = structuredClone(DEFAULT_CONFIG)
    Reflect.deleteProperty(old.features, "subtitleStyle")
    Reflect.deleteProperty(old.appearance, "mode")
    old.features.subtitleMode = "translationOnly"
    const migrated = configSchema.parse(old)
    expect(migrated.features.subtitleStyle).toEqual({ preset: "clear", fontSize: 24, position: { x: 50, y: 88 } })
    expect(migrated.features.subtitleMode).toBe("translationOnly")
    expect(migrated.providersConfig).toEqual(old.providersConfig)
    expect(migrated.appearance).toEqual({ colorTheme: old.appearance.colorTheme, mode: "system" })
  })
  it("merges sequential position and font adjustments into the latest stored config", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
    const a = saveSubtitleStyle({ position: { x: 60, y: 70 } })
    const b = saveSubtitleStyle({ fontSize: 80 })
    await Promise.all([a, b])
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { preset: "clear", fontSize: 80, position: { x: 60, y: 70 } } } })
  })
  it.each([13, 81, 24.5])("rejects out-of-range or fractional subtitle font size %s", (fontSize) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, fontSize }).success).toBe(false)
  })
})
