import { z } from "zod"

export const SUBTITLE_PRESETS = ["clear", "compact", "study"] as const
export const SUBTITLE_FONT_SIZE_MODES = ["video", "fixed"] as const
export const SUBTITLE_FONT_SIZE_MIN = 14
export const SUBTITLE_FONT_SIZE_MAX = 80
// Video sizes are calibrated for a 640px-wide window; fixed sizes are CSS pixels.
export const SUBTITLE_PRESET_FONT_SIZES = {
  video: { clear: 20, compact: 16, study: 24 },
  fixed: { clear: 24, compact: 20, study: 24 },
} as const
export const DEFAULT_SUBTITLE_STYLE = { preset: "clear" as const, fontSize: SUBTITLE_PRESET_FONT_SIZES.video.clear, fontSizeMode: "video" as const, position: { x: 50, y: 88 } }

export const subtitleStyleSchema = z.object({
  preset: z.enum(SUBTITLE_PRESETS).default("clear"),
  fontSize: z.number().int().min(SUBTITLE_FONT_SIZE_MIN).max(SUBTITLE_FONT_SIZE_MAX).default(DEFAULT_SUBTITLE_STYLE.fontSize),
  fontSizeMode: z.enum(SUBTITLE_FONT_SIZE_MODES).default("video"),
  position: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  }).default(DEFAULT_SUBTITLE_STYLE.position),
})

export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>
export type SubtitlePosition = SubtitleStyle["position"]
