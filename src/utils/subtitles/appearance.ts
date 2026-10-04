import type { SubtitlePosition, SubtitleStyle } from "@/types/config/subtitle-style"
import { SUBTITLE_FONT_SIZE_MAX, SUBTITLE_FONT_SIZE_MIN, SUBTITLE_PRESET_STYLES, SUBTITLE_RELATIVE_FONT_SIZE_MAX, SUBTITLE_RELATIVE_FONT_SIZE_MIN, SUBTITLE_RELATIVE_FONT_SIZE_STEP } from "@/types/config/subtitle-style"
import { sendMessage } from "@/utils/message"

export const SUBTITLE_POSITIONS = {
  top: { x: 50, y: 18 },
  center: { x: 50, y: 55 },
  bottom: { x: 50, y: 88 },
} as const

export function subtitlePresetPatch(preset: SubtitleStyle["preset"], _fontSizeMode?: SubtitleStyle["fontSizeMode"]): Pick<SubtitleStyle, "preset" | "fontSize" | "relativeFontSize" | "backgroundEnabled" | "backgroundOpacity"> {
  return { preset, ...SUBTITLE_PRESET_STYLES[preset] }
}

export function subtitleSizeSettings(style: SubtitleStyle) {
  return style.fontSizeMode === "video"
    ? { value: style.relativeFontSize, min: SUBTITLE_RELATIVE_FONT_SIZE_MIN, max: SUBTITLE_RELATIVE_FONT_SIZE_MAX, step: SUBTITLE_RELATIVE_FONT_SIZE_STEP, unit: "%" }
    : { value: style.fontSize, min: SUBTITLE_FONT_SIZE_MIN, max: SUBTITLE_FONT_SIZE_MAX, step: 1, unit: "px" }
}

export function subtitleSizePatch(style: SubtitleStyle, value: number): Partial<Pick<SubtitleStyle, "fontSize" | "relativeFontSize">> {
  return style.fontSizeMode === "video" ? { relativeFontSize: value } : { fontSize: value }
}

export function formatSubtitleFontSize(style: SubtitleStyle): string {
  const { value, unit } = subtitleSizeSettings(style)
  return `${Number(value.toFixed(5))}${unit === "%" ? "%" : ` ${unit}`}`
}

/** A disabled legacy background stays invisible even when its remembered depth is nonzero. */
export function effectiveSubtitleBackgroundOpacity(style: Pick<SubtitleStyle, "backgroundEnabled" | "backgroundOpacity">): number {
  return style.backgroundEnabled ? style.backgroundOpacity : 0
}

/** The depth control is the only background control: zero disables it, a positive depth enables it. */
export function subtitleBackgroundPatch(backgroundOpacity: number): Pick<SubtitleStyle, "backgroundEnabled" | "backgroundOpacity"> {
  return { backgroundOpacity, backgroundEnabled: backgroundOpacity > 0 }
}

/** A preset remains selected only while its active size and visible background settings match. */
export function isSubtitlePresetModified(style: SubtitleStyle): boolean {
  const preset = SUBTITLE_PRESET_STYLES[style.preset]
  const presetSize = style.fontSizeMode === "video" ? preset.relativeFontSize : preset.fontSize
  return Math.abs(subtitleSizeSettings(style).value - presetSize) > 1e-9
    || effectiveSubtitleBackgroundOpacity(style) !== effectiveSubtitleBackgroundOpacity(preset)
}

export function subtitlePositionName(position: SubtitlePosition): keyof typeof SUBTITLE_POSITIONS | "custom" {
  return (Object.keys(SUBTITLE_POSITIONS) as (keyof typeof SUBTITLE_POSITIONS)[]).find(name =>
    Math.abs(position.x - SUBTITLE_POSITIONS[name].x) < 0.5 && Math.abs(position.y - SUBTITLE_POSITIONS[name].y) < 0.5,
  ) ?? "custom"
}

/** Relative sizes are a percentage of video width; fixed sizes are CSS pixels. */
export function resolveSubtitleFontSize(style: SubtitleStyle, videoWidth = 640): number {
  const width = Number.isFinite(videoWidth) && videoWidth > 0 ? videoWidth : 640
  return style.fontSizeMode === "video" ? style.relativeFontSize * width / 100 : style.fontSize
}

/** Shared presentation for the settings preview and the in-video renderer. */
export function subtitleTextStyle(style: SubtitleStyle, videoWidth = 640) {
  return {
    fontSize: `${resolveSubtitleFontSize(style, videoWidth)}px`,
    fontWeight: style.preset === "compact" ? "500" : "600",
    lineHeight: "1.4",
    color: "#fff",
    textAlign: "center" as const,
    whiteSpace: "pre-line" as const,
    textShadow: "0 2px 4px #000,0 0 2px #000",
    background: style.backgroundEnabled ? `rgba(15,20,35,${style.backgroundOpacity / 100})` : "transparent",
    borderRadius: style.backgroundEnabled ? "8px" : "0",
    padding: style.backgroundEnabled ? style.preset === "compact" ? "8px 14px" : "10px 16px" : "0",
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
  const task = writeQueue.then(() => sendMessage("saveSubtitleStylePatch", { patch }))
  writeQueue = task.catch(() => {})
  return task
}
