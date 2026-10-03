import { describe, expect, it } from "vitest"
import { storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { subtitleStyleSchema } from "@/types/config/subtitle-style"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { resolveSubtitleFontSize, resolveSubtitlePosition, saveSubtitleStyle, subtitlePresetPatch } from "../appearance"

describe("subtitle appearance configuration", () => {
  it("scales the saved size to the video window and keeps fixed pixels independent of its width", () => {
    const style = DEFAULT_CONFIG.features.subtitleStyle
    expect(resolveSubtitleFontSize(style, 320)).toBe(10)
    expect(resolveSubtitleFontSize(style, 640)).toBe(20)
    expect(resolveSubtitleFontSize(style, 1280)).toBe(40)
    expect(resolveSubtitleFontSize({ ...style, fontSize: 80 }, 320)).toBe(40)
    expect(resolveSubtitleFontSize({ ...style, fontSizeMode: "fixed" }, 320)).toBe(20)
    expect(resolveSubtitleFontSize({ ...style, fontSizeMode: "fixed" }, 1280)).toBe(20)
    for (const width of [0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(resolveSubtitleFontSize(style, width)).toBe(20)
    expect(style.fontSize).toBe(20)
  })
  it.each([
    { preset: "clear", fontSizeMode: "video", fontSize: 20 },
    { preset: "compact", fontSizeMode: "video", fontSize: 16 },
    { preset: "study", fontSizeMode: "video", fontSize: 24 },
    { preset: "clear", fontSizeMode: "fixed", fontSize: 24 },
    { preset: "compact", fontSizeMode: "fixed", fontSize: 20 },
    { preset: "study", fontSizeMode: "fixed", fontSize: 24 },
  ] as const)("calibrates $preset to $fontSize px in $fontSizeMode mode", ({ preset, fontSizeMode, fontSize }) => {
    const patch = subtitlePresetPatch(preset, fontSizeMode)
    expect(patch).toEqual({ preset, fontSize })
    expect(resolveSubtitleFontSize({ ...DEFAULT_CONFIG.features.subtitleStyle, ...patch, fontSizeMode }, 1920)).toBe(fontSizeMode === "video" ? fontSize * 3 : fontSize)
  })
  it.each([38, 40])("adds video-relative sizing to older styles without replacing saved %s px", (fontSize) => {
    expect(subtitleStyleSchema.parse({ preset: "study", fontSize, position: { x: 60, y: 65 } })).toEqual({ preset: "study", fontSize, fontSizeMode: "video", position: { x: 60, y: 65 } })
    expect(subtitleStyleSchema.parse({ ...DEFAULT_CONFIG.features.subtitleStyle, fontSizeMode: "fixed" }).fontSizeMode).toBe("fixed")
  })
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
    expect(migrated.features.subtitleStyle).toEqual({ preset: "clear", fontSize: 20, fontSizeMode: "video", position: { x: 50, y: 88 } })
    expect(migrated.features.subtitleMode).toBe("translationOnly")
    expect(migrated.providersConfig).toEqual(old.providersConfig)
    expect(migrated.appearance).toEqual({ colorTheme: old.appearance.colorTheme, mode: "system" })
  })
  it("merges sequential position and font adjustments into the latest stored config", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
    const a = saveSubtitleStyle({ position: { x: 60, y: 70 } })
    const b = saveSubtitleStyle({ fontSize: 80, fontSizeMode: "fixed" })
    await Promise.all([a, b])
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { preset: "clear", fontSize: 80, fontSizeMode: "fixed", position: { x: 60, y: 70 } } } })
  })
  it.each([13, 81, 24.5])("rejects out-of-range or fractional subtitle font size %s", (fontSize) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, fontSize }).success).toBe(false)
  })
})
