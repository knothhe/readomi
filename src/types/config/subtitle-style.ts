import { z } from "zod"

export const SUBTITLE_PRESETS = ["clear", "compact", "study", "cinema"] as const
export const SUBTITLE_FONT_SIZE_MODES = ["video", "fixed"] as const
export const SUBTITLE_FONT_SIZE_MIN = 8
export const SUBTITLE_FONT_SIZE_MAX = 80
export const SUBTITLE_RELATIVE_FONT_SIZE_MIN = 1.25
export const SUBTITLE_RELATIVE_FONT_SIZE_MAX = 12.5
export const SUBTITLE_RELATIVE_FONT_SIZE_STEP = 0.25
export const SUBTITLE_PRESET_STYLES = {
  clear: { fontSize: 20, relativeFontSize: 3, backgroundEnabled: false, backgroundOpacity: 0 },
  compact: { fontSize: 16, relativeFontSize: 2.5, backgroundEnabled: true, backgroundOpacity: 35 },
  study: { fontSize: 24, relativeFontSize: 3.75, backgroundEnabled: true, backgroundOpacity: 65 },
  cinema: { fontSize: 28, relativeFontSize: 4.5, backgroundEnabled: true, backgroundOpacity: 85 },
} as const
export const DEFAULT_SUBTITLE_STYLE = { preset: "clear" as const, ...SUBTITLE_PRESET_STYLES.clear, fontSizeMode: "video" as const, position: { x: 50, y: 88 } }

const currentSubtitleStyleSchema = z.object({
  preset: z.enum(SUBTITLE_PRESETS).default("clear"),
  fontSize: z.number().int().min(SUBTITLE_FONT_SIZE_MIN).max(SUBTITLE_FONT_SIZE_MAX).default(DEFAULT_SUBTITLE_STYLE.fontSize),
  relativeFontSize: z.number().min(SUBTITLE_RELATIVE_FONT_SIZE_MIN).max(SUBTITLE_RELATIVE_FONT_SIZE_MAX).default(DEFAULT_SUBTITLE_STYLE.relativeFontSize),
  fontSizeMode: z.enum(SUBTITLE_FONT_SIZE_MODES).default("video"),
  backgroundEnabled: z.boolean().default(DEFAULT_SUBTITLE_STYLE.backgroundEnabled),
  backgroundOpacity: z.number().min(0).max(100).default(DEFAULT_SUBTITLE_STYLE.backgroundOpacity),
  position: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  }).default(DEFAULT_SUBTITLE_STYLE.position),
})

/** Older video sizes were CSS pixels at a 640px width; preserve their visual scale and preset backgrounds. */
export const subtitleStyleSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return value
  const style = value as Record<string, unknown>
  const legacyOpacity = style.preset === "compact" ? 65 : style.preset === "study" ? 35 : style.preset === "cinema" ? SUBTITLE_PRESET_STYLES.cinema.backgroundOpacity : typeof style.fontSize === "number" ? 50 : DEFAULT_SUBTITLE_STYLE.backgroundOpacity
  return {
    ...style,
    relativeFontSize: style.relativeFontSize === undefined && typeof style.fontSize === "number" ? style.fontSize / 6.4 : style.relativeFontSize,
    backgroundEnabled: style.backgroundEnabled === undefined ? style.preset === "compact" || style.preset === "study" || style.preset === "cinema" : style.backgroundEnabled,
    backgroundOpacity: style.backgroundOpacity === undefined ? legacyOpacity : style.backgroundOpacity,
  }
}, currentSubtitleStyleSchema)

export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>
export type SubtitlePosition = SubtitleStyle["position"]
