import { describe, expect, it } from "vitest"
import { storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { resolveSubtitlePosition, saveSubtitleStyle } from "../appearance"

describe("subtitle appearance configuration", () => {
  it("anchors the existing bottom preset to the edge or visible controls without moving custom positions", () => {
    const video = { width: 640, height: 360 }
    const caption = { width: 200, height: 60 }
    const bottom = DEFAULT_CONFIG.features.subtitleStyle.position
    expect(resolveSubtitlePosition(bottom, video, caption).y / 100 * video.height).toBeCloseTo(348)
    expect(resolveSubtitlePosition(bottom, video, caption, 316).y / 100 * video.height).toBeCloseTo(304)
    expect(resolveSubtitlePosition(bottom, { width: 1920, height: 1080 }, caption).y / 100 * 1080).toBeCloseTo(1068)
    expect(resolveSubtitlePosition({ x: 60, y: 65 }, video, caption, 316)).toEqual({ x: 60, y: 65 })
  })
  it("adds defaults to existing configurations without losing the user's translation service or mode", () => {
    const old = structuredClone(DEFAULT_CONFIG)
    Reflect.deleteProperty(old.features, "subtitleStyle")
    old.features.subtitleMode = "translationOnly"
    const migrated = configSchema.parse(old)
    expect(migrated.features.subtitleStyle).toEqual({ preset: "clear", fontSize: 24, position: { x: 50, y: 88 } })
    expect(migrated.features.subtitleMode).toBe("translationOnly")
    expect(migrated.providersConfig).toEqual(old.providersConfig)
  })
  it("merges sequential position and font adjustments into the latest stored config", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
    const a = saveSubtitleStyle({ position: { x: 60, y: 70 } })
    const b = saveSubtitleStyle({ fontSize: 30 })
    await Promise.all([a, b])
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { preset: "clear", fontSize: 30, position: { x: 60, y: 70 } } } })
  })
})
