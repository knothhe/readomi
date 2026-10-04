import { describe, expect, it } from "vitest"
import { storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { subtitleStyleSchema } from "@/types/config/subtitle-style"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { formatSubtitleFontSize, isSubtitlePresetModified, resolveSubtitleFontSize, resolveSubtitlePosition, saveSubtitleStyle, subtitlePresetPatch, subtitleSizePatch, subtitleSizeSettings, subtitleTextStyle } from "../appearance"

describe("subtitle appearance configuration", () => {
  it("scales the saved size to the video window and keeps fixed pixels independent of its width", () => {
    const style = DEFAULT_CONFIG.features.subtitleStyle
    expect(resolveSubtitleFontSize(style, 320)).toBe(9.6)
    expect(resolveSubtitleFontSize(style, 640)).toBe(19.2)
    expect(resolveSubtitleFontSize(style, 1280)).toBe(38.4)
    expect(resolveSubtitleFontSize({ ...style, relativeFontSize: 12.5 }, 320)).toBe(40)
    expect(resolveSubtitleFontSize({ ...style, fontSize: 80 }, 320)).toBe(9.6)
    expect(resolveSubtitleFontSize({ ...style, fontSizeMode: "fixed" }, 320)).toBe(20)
    expect(resolveSubtitleFontSize({ ...style, fontSizeMode: "fixed" }, 1280)).toBe(20)
    for (const width of [0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(resolveSubtitleFontSize(style, width)).toBe(19.2)
    expect(style.fontSize).toBe(20)
  })
  it.each([
    { preset: "clear", fontSize: 20, relativeFontSize: 3, backgroundEnabled: false, backgroundOpacity: 50 },
    { preset: "compact", fontSize: 16, relativeFontSize: 2.5, backgroundEnabled: true, backgroundOpacity: 35 },
    { preset: "study", fontSize: 24, relativeFontSize: 3.75, backgroundEnabled: true, backgroundOpacity: 65 },
    { preset: "cinema", fontSize: 28, relativeFontSize: 4.5, backgroundEnabled: true, backgroundOpacity: 85 },
  ] as const)("applies the $preset starting point without changing mode or position", (expected) => {
    for (const fontSizeMode of ["video", "fixed"] as const) {
      const patch = subtitlePresetPatch(expected.preset, fontSizeMode)
      expect(patch).toEqual(expected)
      const position = { x: 60, y: 65 }
      const original = { ...DEFAULT_CONFIG.features.subtitleStyle, fontSize: 38, relativeFontSize: 7, fontSizeMode, position }
      const style = { ...original, ...patch }
      expect(style.position).toBe(position)
      expect(style.fontSizeMode).toBe(fontSizeMode)
      expect(resolveSubtitleFontSize(style, 1920)).toBeCloseTo(fontSizeMode === "video" ? expected.relativeFontSize * 19.2 : expected.fontSize)
      expect(isSubtitlePresetModified(style)).toBe(false)
    }
  })
  it.each([
    { preset: "clear", backgroundEnabled: false, backgroundOpacity: 50 },
    { preset: "compact", backgroundEnabled: true, backgroundOpacity: 65 },
    { preset: "study", backgroundEnabled: true, backgroundOpacity: 35 },
  ] as const)("migrates older $preset styles without changing their size, background or position", ({ preset, backgroundEnabled, backgroundOpacity }) => {
    for (const fontSizeMode of ["video", "fixed"] as const) {
      const position = { x: 60, y: 65 }
      const migrated = subtitleStyleSchema.parse({ preset, fontSize: 38, fontSizeMode, position })
      expect(migrated).toEqual({ preset, fontSize: 38, relativeFontSize: 5.9375, fontSizeMode, backgroundEnabled, backgroundOpacity, position })
      expect(resolveSubtitleFontSize(migrated, 1280)).toBe(fontSizeMode === "video" ? 76 : 38)
    }
    expect(subtitleStyleSchema.parse({ preset, fontSize: 20 }).fontSizeMode).toBe("video")
  })
  it("uses fresh defaults and preserves explicit fractional proportions, disabled backgrounds and zero depth", () => {
    expect(subtitleStyleSchema.parse({})).toEqual(DEFAULT_CONFIG.features.subtitleStyle)
    const style = { ...DEFAULT_CONFIG.features.subtitleStyle, preset: "study" as const, relativeFontSize: 5.9375, backgroundEnabled: false, backgroundOpacity: 0 }
    expect(subtitleStyleSchema.parse(style)).toEqual(style)
    expect(subtitleTextStyle(style).background).toBe("transparent")
    expect(subtitleTextStyle({ ...style, backgroundEnabled: true }).background).toBe("rgba(15,20,35,0)")
  })
  it("exposes independent size controls and matching units for each mode", () => {
    const style = { ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize: 3.125, fontSize: 38 }
    expect(subtitleSizeSettings(style)).toEqual({ value: 3.125, min: 1.25, max: 12.5, step: 0.25, unit: "%" })
    expect(subtitleSizePatch(style, 3.375)).toEqual({ relativeFontSize: 3.375 })
    expect(formatSubtitleFontSize(style)).toBe("3.125%")
    const fixed = { ...style, fontSizeMode: "fixed" as const }
    expect(subtitleSizeSettings(fixed)).toEqual({ value: 38, min: 8, max: 80, step: 1, unit: "px" })
    expect(subtitleSizePatch(fixed, 8)).toEqual({ fontSize: 8 })
    expect(formatSubtitleFontSize(fixed)).toBe("38 px")
    const migrated = subtitleStyleSchema.parse({ fontSize: 39 })
    expect(formatSubtitleFontSize(migrated)).toBe("6.09375%")
    expect(resolveSubtitleFontSize(migrated, 640)).toBe(39)
  })
  it("uses manual background settings for every preset, including clear", () => {
    const style = { ...DEFAULT_CONFIG.features.subtitleStyle, backgroundEnabled: true, backgroundOpacity: 72 }
    expect(subtitleTextStyle(style)).toMatchObject({ background: "rgba(15,20,35,0.72)", borderRadius: "8px", padding: "10px 16px" })
    const disabled = { ...style, preset: "compact" as const, backgroundEnabled: false }
    expect(subtitleTextStyle(disabled)).toMatchObject({ background: "transparent", borderRadius: "0", padding: "0" })
    expect(disabled.backgroundOpacity).toBe(72)
  })
  it("marks only changes to active size and visible background as a modified preset", () => {
    const clear = DEFAULT_CONFIG.features.subtitleStyle
    expect(isSubtitlePresetModified({ ...clear, fontSize: 80, position: { x: 25, y: 50 }, backgroundOpacity: 0 })).toBe(false)
    expect(isSubtitlePresetModified({ ...clear, relativeFontSize: 3.25 })).toBe(true)
    expect(isSubtitlePresetModified({ ...clear, backgroundEnabled: true })).toBe(true)
    expect(isSubtitlePresetModified({ ...clear, fontSizeMode: "fixed", relativeFontSize: 8 })).toBe(false)
    const compact = { ...clear, ...subtitlePresetPatch("compact") }
    expect(isSubtitlePresetModified({ ...compact, backgroundOpacity: 0 })).toBe(true)
    expect(isSubtitlePresetModified({ ...compact, backgroundEnabled: false })).toBe(true)
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
    expect(migrated.features.subtitleStyle).toEqual(DEFAULT_CONFIG.features.subtitleStyle)
    expect(migrated.features.subtitleMode).toBe("translationOnly")
    expect(migrated.providersConfig).toEqual(old.providersConfig)
    expect(migrated.appearance).toEqual({ colorTheme: old.appearance.colorTheme, mode: "system" })
  })
  it("merges sequential position and font adjustments into the latest stored config", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
    const a = saveSubtitleStyle({ position: { x: 60, y: 70 } })
    const b = saveSubtitleStyle({ fontSize: 80, fontSizeMode: "fixed" })
    await Promise.all([a, b])
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { ...DEFAULT_CONFIG.features.subtitleStyle, fontSize: 80, fontSizeMode: "fixed", position: { x: 60, y: 70 } } } })
  })
  it("migrates an old stored config during a partial write without resetting service settings", async () => {
    const old = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { preset: "study", fontSize: 38, position: { x: 60, y: 65 } } }, providersConfig: DEFAULT_CONFIG.providersConfig.map(provider => ({ ...provider, apiKey: "saved-key" })) }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, old)
    await saveSubtitleStyle({ backgroundEnabled: false, backgroundOpacity: 0 })
    const saved = await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)
    expect(saved).toEqual({ ...old, features: { ...old.features, subtitleStyle: { ...old.features.subtitleStyle, relativeFontSize: 5.9375, fontSizeMode: "video", backgroundEnabled: false, backgroundOpacity: 0 } } })
  })
  it("accepts the new minimum fixed size and maximum relative size", () => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, fontSize: 8, relativeFontSize: 12.5 }).success).toBe(true)
  })
  it.each([7, 81, 24.5])("rejects out-of-range or fractional subtitle font size %s", (fontSize) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, fontSize }).success).toBe(false)
  })
  it.each([1.24, 12.51, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid relative subtitle size %s", (relativeFontSize) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize }).success).toBe(false)
  })
  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid background depth %s", (backgroundOpacity) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, backgroundOpacity }).success).toBe(false)
  })
})
