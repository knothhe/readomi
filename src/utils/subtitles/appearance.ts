import type { SubtitlePosition, SubtitleStyle } from "@/types/config/subtitle-style"
import { storage } from "#imports"
import { subtitleStyleSchema } from "@/types/config/subtitle-style"
import { getLocalConfigForWrite } from "@/utils/config/storage"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"

export const SUBTITLE_POSITIONS = {
  top: { x: 50, y: 18 },
  center: { x: 50, y: 55 },
  bottom: { x: 50, y: 88 },
} as const

export function subtitlePresetPatch(preset: SubtitleStyle["preset"]): Pick<SubtitleStyle, "preset" | "fontSize"> {
  return { preset, fontSize: { clear: 24, compact: 20, study: 40 }[preset] }
}

export function subtitlePositionName(position: SubtitlePosition): keyof typeof SUBTITLE_POSITIONS | "custom" {
  return (Object.keys(SUBTITLE_POSITIONS) as (keyof typeof SUBTITLE_POSITIONS)[]).find(name =>
    Math.abs(position.x - SUBTITLE_POSITIONS[name].x) < 0.5 && Math.abs(position.y - SUBTITLE_POSITIONS[name].y) < 0.5,
  ) ?? "custom"
}

/** Shared presentation for the settings preview and the in-video renderer. */
export function subtitleTextStyle(style: SubtitleStyle) {
  return {
    fontSize: `${style.fontSize}px`,
    fontWeight: style.preset === "compact" ? "500" : "600",
    lineHeight: "1.4",
    color: "#fff",
    textAlign: "center" as const,
    whiteSpace: "pre-line" as const,
    textShadow: "0 2px 4px #000,0 0 2px #000",
    background: style.preset === "clear" ? "transparent" : style.preset === "compact" ? "rgba(15,20,35,.65)" : "rgba(15,20,35,.35)",
    borderRadius: style.preset === "clear" ? "0" : "8px",
    padding: style.preset === "clear" ? "0" : style.preset === "compact" ? "8px 14px" : "10px 16px",
  }
}

/** x is the caption centre, y is its bottom edge, as percentages of the video. */
export function clampSubtitlePosition(position: SubtitlePosition, video: { width: number, height: number }, caption: { width: number, height: number }, bottomMarginPx?: number): SubtitlePosition {
  if (video.width <= 0 || video.height <= 0)
    return position
  const margin = Math.min(12, video.width / 20, video.height / 20)
  const bottomMargin = Math.min(margin, bottomMarginPx ?? margin)
  const half = Math.min(caption.width / 2, video.width / 2 - margin)
  const height = Math.min(caption.height, video.height - margin - bottomMargin)
  return {
    x: Math.max((half + margin) / video.width * 100, Math.min(position.x, (video.width - half - margin) / video.width * 100)),
    y: Math.max((height + margin) / video.height * 100, Math.min(position.y, (video.height - bottomMargin) / video.height * 100)),
  }
}

/** Keep the stored preset compatible while matching YouTube's 2% bottom inset. */
export function resolveSubtitlePosition(position: SubtitlePosition, video: { width: number, height: number }, caption: { width: number, height: number }, bottomEdge?: number): SubtitlePosition {
  if (video.height > 0 && subtitlePositionName(position) === "bottom") {
    const edge = bottomEdge ?? video.height * 0.98
    return clampSubtitlePosition({ x: position.x, y: edge / video.height * 100 }, video, caption, video.height * 0.02)
  }
  return clampSubtitlePosition(position, video, caption)
}

let writeQueue = Promise.resolve()
/** One storage write at the end of a drag, merging with the latest configuration. */
export function saveSubtitleStyle(patch: Partial<SubtitleStyle>): Promise<void> {
  const task = writeQueue.then(async () => {
    const latest = await getLocalConfigForWrite()
    const subtitleStyle = subtitleStyleSchema.parse({ ...latest.features.subtitleStyle, ...patch })
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, { ...latest, features: { ...latest.features, subtitleStyle } })
  })
  writeQueue = task.catch(() => {})
  return task
}
