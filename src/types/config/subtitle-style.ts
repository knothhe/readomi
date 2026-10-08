import { z } from "zod"

export const SUBTITLE_PRESETS = ["clear", "compact", "study", "cinema"] as const
export const SUBTITLE_RELATIVE_FONT_SIZE_MIN = 1.25
export const SUBTITLE_RELATIVE_FONT_SIZE_MAX = 25
export const SUBTITLE_RELATIVE_FONT_SIZE_STEP = 0.25
export const SUBTITLE_ORIGINAL_FONT_SCALE_MIN = 50
export const SUBTITLE_ORIGINAL_FONT_SCALE_MAX = 150
export const SUBTITLE_ORIGINAL_FONT_SCALE_STEP = 5
export const SUBTITLE_PRESET_STYLES = {
  clear: { relativeFontSize: 5, backgroundEnabled: false, backgroundOpacity: 0 },
  compact: { relativeFontSize: 4, backgroundEnabled: true, backgroundOpacity: 35 },
  study: { relativeFontSize: 6.25, backgroundEnabled: true, backgroundOpacity: 65 },
  cinema: { relativeFontSize: 7.5, backgroundEnabled: true, backgroundOpacity: 85 },
} as const
export const DEFAULT_SUBTITLE_STYLE = { preset: "clear" as const, ...SUBTITLE_PRESET_STYLES.clear, originalFontScale: 100, relativeFontSizeBasis: "shortSide" as const, position: { x: 50, y: 88 } }

const currentSubtitleStyleSchema = z.object({
  preset: z.enum(SUBTITLE_PRESETS).default("clear"),
  relativeFontSize: z.number().min(SUBTITLE_RELATIVE_FONT_SIZE_MIN).max(SUBTITLE_RELATIVE_FONT_SIZE_MAX).default(DEFAULT_SUBTITLE_STYLE.relativeFontSize),
  relativeFontSizeBasis: z.literal("shortSide").default("shortSide"),
  originalFontScale: z.number().min(SUBTITLE_ORIGINAL_FONT_SCALE_MIN).max(SUBTITLE_ORIGINAL_FONT_SCALE_MAX).multipleOf(SUBTITLE_ORIGINAL_FONT_SCALE_STEP).default(DEFAULT_SUBTITLE_STYLE.originalFontScale),
  backgroundEnabled: z.boolean().default(DEFAULT_SUBTITLE_STYLE.backgroundEnabled),
  backgroundOpacity: z.number().min(0).max(100).default(DEFAULT_SUBTITLE_STYLE.backgroundOpacity),
  position: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  }).default(DEFAULT_SUBTITLE_STYLE.position),
})

/** Migrate fixed pixels and legacy width proportions once to the displayed short side. */
export const subtitleStyleSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return value
  const style = value as Record<string, unknown>
  let relativeFontSize = style.relativeFontSize
  if (style.fontSizeMode === "fixed") {
    const pixels = z.number().int().min(8).max(80).default(20).safeParse(style.fontSize)
    relativeFontSize = pixels.success ? pixels.data / 3.6 : Number.NaN
  }
  else if (style.relativeFontSizeBasis === undefined) {
    const oldPresetSizes = { clear: 3, compact: 2.5, study: 3.75, cinema: 4.5 } as const
    const preset = typeof style.preset === "string" && style.preset in oldPresetSizes ? style.preset as keyof typeof oldPresetSizes : "clear"
    if (relativeFontSize === oldPresetSizes[preset])
      relativeFontSize = SUBTITLE_PRESET_STYLES[preset].relativeFontSize
    else if (typeof relativeFontSize === "number")
      relativeFontSize *= 16 / 9
    else if (relativeFontSize === undefined && typeof style.fontSize === "number")
      relativeFontSize = style.fontSize / 3.6
  }
  const legacyOpacity = style.preset === "compact" ? 65 : style.preset === "study" ? 35 : style.preset === "cinema" ? SUBTITLE_PRESET_STYLES.cinema.backgroundOpacity : typeof style.fontSize === "number" ? 50 : DEFAULT_SUBTITLE_STYLE.backgroundOpacity
  return {
    ...style,
    relativeFontSize,
    backgroundEnabled: style.backgroundEnabled === undefined ? style.preset === "compact" || style.preset === "study" || style.preset === "cinema" : style.backgroundEnabled,
    backgroundOpacity: style.backgroundOpacity === undefined ? legacyOpacity : style.backgroundOpacity,
  }
}, currentSubtitleStyleSchema)

export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>
export type SubtitlePosition = SubtitleStyle["position"]
