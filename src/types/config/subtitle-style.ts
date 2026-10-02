import { z } from "zod"

export const SUBTITLE_PRESETS = ["clear", "compact", "study"] as const
export const SUBTITLE_FONT_SIZE_MIN = 14
export const SUBTITLE_FONT_SIZE_MAX = 80
export const DEFAULT_SUBTITLE_STYLE = { preset: "clear" as const, fontSize: 24, position: { x: 50, y: 88 } }

export const subtitleStyleSchema = z.object({
  preset: z.enum(SUBTITLE_PRESETS).default("clear"),
  fontSize: z.number().int().min(SUBTITLE_FONT_SIZE_MIN).max(SUBTITLE_FONT_SIZE_MAX).default(24),
  position: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  }).default(DEFAULT_SUBTITLE_STYLE.position),
})

export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>
export type SubtitlePosition = SubtitleStyle["position"]
