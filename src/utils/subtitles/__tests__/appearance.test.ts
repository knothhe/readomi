import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { setupSiteRuleSessions } from "@/entrypoints/background/site-rule-sessions"
import { configSchema } from "@/types/config/config"
import { subtitleStyleSchema } from "@/types/config/subtitle-style"
import { withConfigWriteLock } from "@/utils/config/write-lock"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"
import { effectiveSubtitleBackgroundOpacity, formatSubtitleFontSize, isSubtitlePresetModified, resolveSubtitleFontSize, resolveSubtitlePosition, saveSubtitleStyle, subtitleBackgroundPatch, subtitlePresetPatch, subtitleSizePatch, subtitleSizeSettings, subtitleTextStyle } from "../appearance"

describe("subtitle appearance configuration", () => {
  beforeEach(() => {
    fakeBrowser.reset()
    setupSiteRuleSessions()
  })
  afterEach(() => vi.restoreAllMocks())

  it("scales the saved size to the video window and keeps fixed pixels independent of its width", () => {
    const style = DEFAULT_CONFIG.features.subtitleStyle
    expect(resolveSubtitleFontSize(style, 320)).toBe(9)
    expect(resolveSubtitleFontSize(style, 640)).toBe(18)
    expect(resolveSubtitleFontSize(style, 1280)).toBe(36)
    expect(resolveSubtitleFontSize({ ...style, relativeFontSize: 12.5 }, 320)).toBe(22.5)
    expect(resolveSubtitleFontSize({ ...style, fontSize: 80 }, 320)).toBe(9)
    expect(resolveSubtitleFontSize({ ...style, fontSizeMode: "fixed" }, 320)).toBe(20)
    expect(resolveSubtitleFontSize({ ...style, fontSizeMode: "fixed" }, 1280)).toBe(20)
    for (const width of [0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(resolveSubtitleFontSize(style, width)).toBe(18)
    expect(style.fontSize).toBe(20)
  })
  it("uses the shorter displayed side for portrait, square, ultrawide and invalid dimensions", () => {
    const style = DEFAULT_CONFIG.features.subtitleStyle
    expect(resolveSubtitleFontSize(style, 285, 506)).toBe(14.25)
    expect(resolveSubtitleFontSize(style, 400, 400)).toBe(20)
    expect(resolveSubtitleFontSize(style, 960, 400)).toBe(20)
    expect(resolveSubtitleFontSize({ ...style, fontSizeMode: "fixed" }, 285, 506)).toBe(20)
    for (const height of [0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(resolveSubtitleFontSize(style, 640, height)).toBe(18)
    expect(resolveSubtitleFontSize(style, 0, 0)).toBe(18)
  })
  it("updates legacy presets and migrates custom proportions only once", () => {
    for (const [preset, oldSize, newSize] of [["clear", 3, 5], ["compact", 2.5, 4], ["study", 3.75, 6.25], ["cinema", 4.5, 7.5]] as const) {
      const migrated = subtitleStyleSchema.parse({ preset, relativeFontSize: oldSize })
      expect(migrated.relativeFontSize).toBe(newSize)
      expect(subtitleStyleSchema.parse(migrated)).toEqual(migrated)
    }
    const custom = subtitleStyleSchema.parse({ relativeFontSize: 7, fontSize: 38, fontSizeMode: "fixed" })
    expect(custom.relativeFontSize).toBeCloseTo(7 * 16 / 9)
    expect(custom.fontSize).toBe(38)
    expect(custom.fontSizeMode).toBe("fixed")
    expect(subtitleStyleSchema.parse(custom)).toEqual(custom)
    expect(subtitleStyleSchema.parse({ relativeFontSize: 12.5 }).relativeFontSize).toBeCloseTo(12.5 * 16 / 9)
  })
  it.each([
    { preset: "clear", fontSize: 20, relativeFontSize: 5, backgroundEnabled: false, backgroundOpacity: 0 },
    { preset: "compact", fontSize: 16, relativeFontSize: 4, backgroundEnabled: true, backgroundOpacity: 35 },
    { preset: "study", fontSize: 24, relativeFontSize: 6.25, backgroundEnabled: true, backgroundOpacity: 65 },
    { preset: "cinema", fontSize: 28, relativeFontSize: 7.5, backgroundEnabled: true, backgroundOpacity: 85 },
  ] as const)("applies the $preset starting point without changing mode or position", (expected) => {
    for (const fontSizeMode of ["video", "fixed"] as const) {
      const patch = subtitlePresetPatch(expected.preset, fontSizeMode)
      expect(patch).toEqual(expected)
      const position = { x: 60, y: 65 }
      const original = { ...DEFAULT_CONFIG.features.subtitleStyle, fontSize: 38, relativeFontSize: 7, fontSizeMode, position }
      const style = { ...original, ...patch }
      expect(style.position).toBe(position)
      expect(style.fontSizeMode).toBe(fontSizeMode)
      expect(resolveSubtitleFontSize(style, 1920)).toBeCloseTo(fontSizeMode === "video" ? expected.relativeFontSize * 10.8 : expected.fontSize)
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
      expect(migrated).toEqual({ preset, fontSize: 38, relativeFontSize: 38 / 3.6, relativeFontSizeBasis: "shortSide", fontSizeMode, backgroundEnabled, backgroundOpacity, position })
      expect(resolveSubtitleFontSize(migrated, 1280)).toBeCloseTo(fontSizeMode === "video" ? 76 : 38)
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
    expect(subtitleSizeSettings(style)).toEqual({ value: 3.125, min: 1.25, max: 25, step: 0.25, unit: "%" })
    expect(subtitleSizePatch(style, 3.375)).toEqual({ relativeFontSize: 3.375 })
    expect(formatSubtitleFontSize(style)).toBe("3.125%")
    const fixed = { ...style, fontSizeMode: "fixed" as const }
    expect(subtitleSizeSettings(fixed)).toEqual({ value: 38, min: 8, max: 80, step: 1, unit: "px" })
    expect(subtitleSizePatch(fixed, 8)).toEqual({ fontSize: 8 })
    expect(formatSubtitleFontSize(fixed)).toBe("38 px")
    const migrated = subtitleStyleSchema.parse({ fontSize: 39 })
    expect(formatSubtitleFontSize(migrated)).toBe("10.83333%")
    expect(resolveSubtitleFontSize(migrated, 640)).toBeCloseTo(39)
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
    expect(isSubtitlePresetModified({ ...clear, backgroundEnabled: true, backgroundOpacity: 35 })).toBe(true)
    expect(isSubtitlePresetModified({ ...clear, backgroundEnabled: false, backgroundOpacity: 72 })).toBe(false)
    expect(isSubtitlePresetModified({ ...clear, backgroundEnabled: true, backgroundOpacity: 0 })).toBe(false)
    expect(isSubtitlePresetModified({ ...clear, fontSizeMode: "fixed", relativeFontSize: 8 })).toBe(false)
    const compact = { ...clear, ...subtitlePresetPatch("compact") }
    expect(isSubtitlePresetModified({ ...compact, backgroundOpacity: 0 })).toBe(true)
    expect(isSubtitlePresetModified({ ...compact, backgroundEnabled: false })).toBe(true)
  })
  it("shows disabled legacy backgrounds as zero without overwriting their stored depth", () => {
    const legacy = { ...DEFAULT_CONFIG.features.subtitleStyle, backgroundEnabled: false, backgroundOpacity: 72 }
    expect(effectiveSubtitleBackgroundOpacity(legacy)).toBe(0)
    expect(subtitleStyleSchema.parse(legacy)).toEqual(legacy)
    expect(subtitleBackgroundPatch(35)).toEqual({ backgroundEnabled: true, backgroundOpacity: 35 })
    expect(subtitleBackgroundPatch(0)).toEqual({ backgroundEnabled: false, backgroundOpacity: 0 })
    expect(effectiveSubtitleBackgroundOpacity({ ...legacy, ...subtitleBackgroundPatch(35) })).toBe(35)
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
    expect(saved).toEqual({ ...old, features: { ...old.features, subtitleStyle: { ...old.features.subtitleStyle, relativeFontSize: 38 / 3.6, relativeFontSizeBasis: "shortSide", fontSizeMode: "video", backgroundEnabled: false, backgroundOpacity: 0 } } })
  })
  it("serializes background style patches with other configuration writes and merges each into the latest value", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
    let release!: () => void
    let started!: () => void
    const held = new Promise<void>(resolve => release = resolve)
    const writing = new Promise<void>(resolve => started = resolve)
    const updated = { ...DEFAULT_CONFIG, reading: { ...DEFAULT_CONFIG.reading, wordPrefixEmphasis: true } }
    const otherWrite = withConfigWriteLock(async () => {
      started()
      await held
      await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, updated)
    })
    await writing
    const messages = vi.spyOn(fakeBrowser.runtime, "sendMessage")
    const a = sendMessage("saveSubtitleStylePatch", { patch: { position: { x: 60, y: 70 } } })
    const b = sendMessage("saveSubtitleStylePatch", { patch: { fontSize: 80, fontSizeMode: "fixed" } })
    await vi.waitFor(() => expect(messages).toHaveBeenCalledTimes(2))
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(DEFAULT_CONFIG)
    release()
    await Promise.all([otherWrite, a, b])
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...updated, features: { ...updated.features, subtitleStyle: { ...updated.features.subtitleStyle, fontSize: 80, fontSizeMode: "fixed", position: { x: 60, y: 70 } } } })
  })
  it("reports an invalid patch without saving and permits a later valid update", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
    await expect(saveSubtitleStyle({ fontSize: 81 })).rejects.toThrow("字幕样式参数无效")
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(DEFAULT_CONFIG)
    await saveSubtitleStyle({ fontSize: 40 })
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { ...DEFAULT_CONFIG.features.subtitleStyle, fontSize: 40 } } })
  })
  it("accepts the new minimum fixed size and maximum relative size", () => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, fontSize: 8, relativeFontSize: 12.5 }).success).toBe(true)
  })
  it.each([7, 81, 24.5])("rejects out-of-range or fractional subtitle font size %s", (fontSize) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, fontSize }).success).toBe(false)
  })
  it.each([1.24, 25.01, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid relative subtitle size %s", (relativeFontSize) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize }).success).toBe(false)
  })
  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid background depth %s", (backgroundOpacity) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, backgroundOpacity }).success).toBe(false)
  })
})
