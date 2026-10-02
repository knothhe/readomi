import { z } from "zod"

export const SUBTITLE_PRESETS = ["clear", "compact", "study"] as const
export const DEFAULT_SUBTITLE_STYLE = { preset: "clear" as const, fontSize: 24, position: { x: 50, y: 88 } }

export const subtitleStyleSchema = z.object({
  preset: z.enum(SUBTITLE_PRESETS).default("clear"),
  fontSize: z.number().int().min(14).max(40).default(24),
  position: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  }).default(DEFAULT_SUBTITLE_STYLE.position),
})

export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>
export type SubtitlePosition = SubtitleStyle["position"]
