import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { setupSiteRuleSessions } from "@/entrypoints/background/site-rule-sessions"
import { configSchema } from "@/types/config/config"
import { SUBTITLE_PRESETS, subtitleStyleSchema } from "@/types/config/subtitle-style"
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

  it("scales both lines with the video short side across landscape, portrait and square sizes", () => {
    const style = DEFAULT_CONFIG.features.subtitleStyle
    for (const [width, height, expected] of [[320, 180, 6.3], [640, 360, 12.6], [1280, 720, 25.2], [285, 506, 9.975], [400, 400, 14], [960, 400, 14]]) {
      expect(resolveSubtitleFontSize(style, width, height)).toBeCloseTo(expected)
      expect(resolveSubtitleFontSize({ ...style, relativeFontSize: 6.25 }, width, height)).toBeCloseTo(expected * 6.25 / 3.5)
    }
    for (const width of [0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(resolveSubtitleFontSize(style, width)).toBe(12.6)
    for (const height of [0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(resolveSubtitleFontSize(style, 640, height)).toBe(12.6)
  })
  it.each(SUBTITLE_PRESETS)("starts %s at the previous 100% size reduced to 87.5% and equal original and translated lines", (preset) => {
    const style = { ...DEFAULT_CONFIG.features.subtitleStyle, ...subtitlePresetPatch(preset) }
    expect(formatSubtitleFontSize(style)).toBe("100%")
    expect(resolveSubtitleFontSize(style, 640, 360)).toBeCloseTo(12.6)
    expect(subtitleTextStyle(style)["--readomi-original-font-scale"]).toBe("1em")
    expect(subtitleSizePatch(150)).toEqual({ relativeFontSize: 5.25 })
    expect(isSubtitlePresetModified({ ...style, ...subtitleSizePatch(150) })).toBe(true)
  })
  it("updates legacy presets and migrates custom width proportions only once", () => {
    for (const [preset, oldSize, newSize] of [["clear", 3, 5], ["compact", 2.5, 4], ["study", 3.75, 6.25], ["cinema", 4.5, 7.5]] as const) {
      const migrated = subtitleStyleSchema.parse({ preset, relativeFontSize: oldSize })
      expect(migrated.relativeFontSize).toBe(newSize)
      expect(subtitleStyleSchema.parse(migrated)).toEqual(migrated)
    }
    const custom = subtitleStyleSchema.parse({ relativeFontSize: 7, fontSize: 38, fontSizeMode: "video" })
    expect(custom.relativeFontSize).toBeCloseTo(7 * 16 / 9)
    expect(custom).not.toHaveProperty("fontSize")
    expect(custom).not.toHaveProperty("fontSizeMode")
    expect(subtitleStyleSchema.parse(custom)).toEqual(custom)
  })
  it.each([8, 20, 38, 80])("migrates fixed %s pixels, ignoring inactive relative sizes and preserving other preferences", (fontSize) => {
    for (const relativeFontSizeBasis of [undefined, "shortSide"]) {
      const position = { x: 60, y: 65 }
      const migrated = subtitleStyleSchema.parse({ fontSize, fontSizeMode: "fixed", relativeFontSize: 7, relativeFontSizeBasis, originalFontScale: 85, backgroundEnabled: true, backgroundOpacity: 72, position })
      expect(resolveSubtitleFontSize(migrated, 640, 360)).toBeCloseTo(fontSize)
      expect(resolveSubtitleFontSize(migrated, 1280, 720)).toBeCloseTo(fontSize * 2)
      expect(migrated).toMatchObject({ originalFontScale: 85, backgroundEnabled: true, backgroundOpacity: 72, position })
      expect(migrated).not.toHaveProperty("fontSize")
      expect(migrated).not.toHaveProperty("fontSizeMode")
      expect(subtitleStyleSchema.parse(migrated)).toEqual(migrated)
    }
  })
  it("uses the same migration when loading or importing a full configuration", () => {
    const old = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { ...DEFAULT_CONFIG.features.subtitleStyle, fontSize: 38, fontSizeMode: "fixed" } } }
    const migrated = configSchema.parse(old)
    expect(resolveSubtitleFontSize(migrated.features.subtitleStyle, 640)).toBeCloseTo(38)
    expect(migrated.providersConfig).toEqual(old.providersConfig)
    expect(configSchema.parse(migrated)).toEqual(migrated)
    const defaults = subtitleStyleSchema.parse({ fontSizeMode: "fixed" })
    expect(resolveSubtitleFontSize(defaults, 640)).toBeCloseTo(20)
  })
  it.each([
    { preset: "clear", relativeFontSize: 3.5, backgroundEnabled: false, backgroundOpacity: 0 },
    { preset: "compact", relativeFontSize: 4, backgroundEnabled: true, backgroundOpacity: 35 },
    { preset: "study", relativeFontSize: 6.25, backgroundEnabled: true, backgroundOpacity: 65 },
    { preset: "cinema", relativeFontSize: 7.5, backgroundEnabled: true, backgroundOpacity: 85 },
  ] as const)("applies the $preset starting point without changing position", (expected) => {
    const position = { x: 60, y: 65 }
    const original = { ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize: 7, originalFontScale: 85, position }
    const style = { ...original, ...subtitlePresetPatch(expected.preset) }
    expect(style).toMatchObject(expected)
    expect(style.position).toBe(position)
    expect(style.originalFontScale).toBe(expected.preset === "clear" ? 100 : 85)
    expect(isSubtitlePresetModified(style)).toBe(false)
  })
  it.each([
    { preset: "clear", backgroundEnabled: false, backgroundOpacity: 50 },
    { preset: "compact", backgroundEnabled: true, backgroundOpacity: 65 },
    { preset: "study", backgroundEnabled: true, backgroundOpacity: 35 },
  ] as const)("migrates older $preset pixel-only styles without losing background or position", ({ preset, backgroundEnabled, backgroundOpacity }) => {
    const position = { x: 60, y: 65 }
    const migrated = subtitleStyleSchema.parse({ preset, fontSize: 38, position })
    expect(migrated).toEqual({ preset, relativeFontSize: 38 / 3.6, relativeFontSizeBasis: "shortSide", originalFontScale: 100, translationFont: "sans", translationColor: "#ffffff", backgroundEnabled, backgroundOpacity, position })
    expect(resolveSubtitleFontSize(migrated, 640)).toBeCloseTo(38)
  })
  it("uses fresh defaults and preserves explicit fractional proportions, disabled backgrounds and zero depth", () => {
    expect(subtitleStyleSchema.parse({})).toEqual(DEFAULT_CONFIG.features.subtitleStyle)
    const style = { ...DEFAULT_CONFIG.features.subtitleStyle, preset: "study" as const, relativeFontSize: 5.9375, backgroundEnabled: false, backgroundOpacity: 0 }
    expect(subtitleStyleSchema.parse(style)).toEqual(style)
    expect(subtitleTextStyle(style).background).toBe("transparent")
    expect(subtitleTextStyle({ ...style, backgroundEnabled: true }).background).toBe("rgba(15,20,35,0)")
  })
  it("defaults old styles to equal lines and preserves the independently saved original ratio", () => {
    const old = structuredClone(DEFAULT_CONFIG)
    Reflect.deleteProperty(old.features.subtitleStyle, "originalFontScale")
    expect(configSchema.parse(old).features.subtitleStyle.originalFontScale).toBe(100)
    const style = { ...DEFAULT_CONFIG.features.subtitleStyle, originalFontScale: 85 }
    expect(subtitleStyleSchema.parse(style)).toEqual(style)
    expect(subtitleTextStyle(style)["--readomi-original-font-scale"]).toBe("0.85em")
    expect(subtitleTextStyle(DEFAULT_CONFIG.features.subtitleStyle)["--readomi-original-font-scale"]).toBe("1em")
  })
  it.each([50, 85, 100, 125, 150])("accepts original ratio %s without changing the translation size", (originalFontScale) => {
    const style = subtitleStyleSchema.parse({ ...DEFAULT_CONFIG.features.subtitleStyle, originalFontScale })
    expect(subtitleTextStyle(style)["--readomi-original-font-scale"]).toBe(`${originalFontScale / 100}em`)
    expect(resolveSubtitleFontSize(style)).toBe(12.6)
  })
  it.each([49, 151, 86, 102.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid original ratio %s", (originalFontScale) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, originalFontScale }).success).toBe(false)
  })
  it("shows normalized percentages and preserves precise imported values", () => {
    const style = { ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize: 3.125 }
    expect(subtitleSizeSettings(style)).toEqual({ value: 89.28571, min: 1.25 * (100 / 3.5), max: 25 * (100 / 3.5), step: 0.25 * (100 / 3.5), unit: "%" })
    expect(subtitleSizePatch(67.5)).toEqual({ relativeFontSize: 2.3625 })
    expect(formatSubtitleFontSize(style)).toBe("89.28571%")
    expect(formatSubtitleFontSize(DEFAULT_CONFIG.features.subtitleStyle)).toBe("100%")
    const migrated = subtitleStyleSchema.parse({ fontSize: 39 })
    expect(formatSubtitleFontSize(migrated)).toBe("309.52381%")
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
    expect(isSubtitlePresetModified({ ...clear, position: { x: 25, y: 50 }, backgroundOpacity: 0 })).toBe(false)
    expect(isSubtitlePresetModified({ ...clear, relativeFontSize: 3.25 })).toBe(true)
    expect(isSubtitlePresetModified({ ...clear, backgroundEnabled: true, backgroundOpacity: 35 })).toBe(true)
    expect(isSubtitlePresetModified({ ...clear, backgroundEnabled: false, backgroundOpacity: 72 })).toBe(false)
    expect(isSubtitlePresetModified({ ...clear, backgroundEnabled: true, backgroundOpacity: 0 })).toBe(false)
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
    const b = saveSubtitleStyle({ relativeFontSize: 25 })
    await Promise.all([a, b])
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize: 25, position: { x: 60, y: 70 } } } })
  })
  it("migrates an old stored config during a partial write without resetting service settings", async () => {
    const old = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { preset: "study", fontSize: 38, position: { x: 60, y: 65 } } }, providersConfig: DEFAULT_CONFIG.providersConfig.map(provider => ({ ...provider, apiKey: "saved-key" })) }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, old)
    await saveSubtitleStyle({ backgroundEnabled: false, backgroundOpacity: 0 })
    const saved = await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)
    expect(saved).toEqual({ ...old, features: { ...old.features, subtitleStyle: { preset: "study", position: { x: 60, y: 65 }, relativeFontSize: 38 / 3.6, relativeFontSizeBasis: "shortSide", originalFontScale: 100, translationFont: "sans", translationColor: "#ffffff", backgroundEnabled: false, backgroundOpacity: 0 } } })
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
    const b = sendMessage("saveSubtitleStylePatch", { patch: { relativeFontSize: 25 } })
    await vi.waitFor(() => expect(messages).toHaveBeenCalledTimes(2))
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(DEFAULT_CONFIG)
    release()
    await Promise.all([otherWrite, a, b])
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...updated, features: { ...updated.features, subtitleStyle: { ...updated.features.subtitleStyle, relativeFontSize: 25, position: { x: 60, y: 70 } } } })
  })
  it("reports an invalid patch without saving and permits a later valid update", async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
    await expect(saveSubtitleStyle({ relativeFontSize: 25.01 })).rejects.toThrow("字幕样式参数无效")
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(DEFAULT_CONFIG)
    await saveSubtitleStyle({ relativeFontSize: 10 })
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, subtitleStyle: { ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize: 10 } } })
  })
  it.each([1.25, 25])("accepts boundary relative size %s", (relativeFontSize) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize }).success).toBe(true)
  })
  it.each([7, 81, 24.5])("rejects invalid legacy fixed pixels %s", (fontSize) => {
    expect(subtitleStyleSchema.safeParse({ fontSize, fontSizeMode: "fixed" }).success).toBe(false)
  })
  it.each([1.24, 25.01, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid relative subtitle size %s", (relativeFontSize) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, relativeFontSize }).success).toBe(false)
  })
  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid background depth %s", (backgroundOpacity) => {
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, backgroundOpacity }).success).toBe(false)
  })
})

describe("subtitle translation font and color validation", () => {
  it("preserves legacy subtitle size, background, original ratio and position while adding safe typography defaults", () => {
    const old = { preset: "compact", relativeFontSize: 4.125, relativeFontSizeBasis: "shortSide", originalFontScale: 125, backgroundEnabled: false, backgroundOpacity: 65, position: { x: 60, y: 70 } }
    const migrated = subtitleStyleSchema.parse(old)
    expect(migrated).toEqual({ ...old, translationFont: "sans", translationColor: "#ffffff" })
    expect(subtitleStyleSchema.parse(migrated)).toEqual(migrated)
  })

  it("normalizes a valid hex color and rejects unsupported fonts or injected color values", () => {
    expect(subtitleStyleSchema.parse({ ...DEFAULT_CONFIG.features.subtitleStyle, translationColor: "#AbCDEF", translationFont: "serif" })).toMatchObject({ translationColor: "#abcdef", translationFont: "serif" })
    for (const translationColor of ["#fff", "red", "var(--page-color)", "#ffffgg", "#ffffffff", null])
      expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, translationColor }).success).toBe(false)
    expect(subtitleStyleSchema.safeParse({ ...DEFAULT_CONFIG.features.subtitleStyle, translationFont: "custom" }).success).toBe(false)
  })

  it("marks changes to font, color or original ratio, but keeps dragged position independent of a preset", () => {
    const gold = { ...DEFAULT_CONFIG.features.subtitleStyle, ...subtitlePresetPatch("gold") }
    expect(isSubtitlePresetModified(gold)).toBe(false)
    expect(isSubtitlePresetModified({ ...gold, translationFont: "sans" })).toBe(true)
    expect(isSubtitlePresetModified({ ...gold, translationColor: "#ffffff" })).toBe(true)
    expect(isSubtitlePresetModified({ ...gold, originalFontScale: 85 })).toBe(true)
    expect(isSubtitlePresetModified({ ...gold, position: { x: 20, y: 40 } })).toBe(false)
  })
})
