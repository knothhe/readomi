import type { SubtitlePosition, SubtitleStyle } from "@/types/config/subtitle-style"
import { SUBTITLE_DEFAULT_SIZE_BASIS, SUBTITLE_FONT_SIZE_PERCENT_STEP, SUBTITLE_PRESET_STYLES, SUBTITLE_PRESETS, SUBTITLE_RELATIVE_FONT_SIZE_MAX, SUBTITLE_RELATIVE_FONT_SIZE_MIN } from "@/types/config/subtitle-style"
import { TRANSLATION_FONT_FAMILIES } from "@/types/config/translation-font"
import { sendMessage } from "@/utils/message"

export const SUBTITLE_POSITIONS = {
  top: { x: 50, y: 18 },
  center: { x: 50, y: 55 },
  bottom: { x: 50, y: 88 },
} as const

export function subtitlePresetPatch(preset: SubtitleStyle["preset"]): Partial<SubtitleStyle> & Pick<SubtitleStyle, "preset" | "relativeFontSize" | "backgroundEnabled" | "backgroundOpacity"> {
  return { preset, ...SUBTITLE_PRESET_STYLES[preset] }
}

const FONT_SCALE_FACTOR = 100 / SUBTITLE_DEFAULT_SIZE_BASIS

/** The reader sees 100% at the default short-side proportion, independently of the preset. */
export function subtitleSizeSettings(style: SubtitleStyle) {
  return {
    value: Number((style.relativeFontSize * FONT_SCALE_FACTOR).toFixed(2)),
    min: SUBTITLE_RELATIVE_FONT_SIZE_MIN * FONT_SCALE_FACTOR,
    max: SUBTITLE_RELATIVE_FONT_SIZE_MAX * FONT_SCALE_FACTOR,
    step: SUBTITLE_FONT_SIZE_PERCENT_STEP,
    unit: "%",
  }
}

export function subtitleSizePatch(value: number): Pick<SubtitleStyle, "relativeFontSize"> {
  return { relativeFontSize: Number((value / FONT_SCALE_FACTOR).toFixed(12)) }
}

export function formatSubtitleFontSize(style: SubtitleStyle): string {
  return `${subtitleSizeSettings(style).value}%`
}

/** A disabled legacy background stays invisible even when its remembered depth is nonzero. */
export function effectiveSubtitleBackgroundOpacity(style: Pick<SubtitleStyle, "backgroundEnabled" | "backgroundOpacity">): number {
  return style.backgroundEnabled ? style.backgroundOpacity : 0
}

/** The depth control is the only background control: zero disables it, a positive depth enables it. */
export function subtitleBackgroundPatch(backgroundOpacity: number): Pick<SubtitleStyle, "backgroundEnabled" | "backgroundOpacity"> {
  return { backgroundOpacity, backgroundEnabled: backgroundOpacity > 0 }
}

/** A preset remains selected while all of its appearance settings match; position stays independent. */
export function isSubtitlePresetModified(style: SubtitleStyle): boolean {
  const preset = SUBTITLE_PRESET_STYLES[style.preset]
  return Math.abs(style.relativeFontSize - preset.relativeFontSize) > 1e-9
    || ("originalFontScale" in preset && style.originalFontScale !== preset.originalFontScale)
    || ("translationFont" in preset && style.translationFont !== preset.translationFont)
    || ("translationColor" in preset && style.translationColor.toLowerCase() !== preset.translationColor)
    || effectiveSubtitleBackgroundOpacity(style) !== effectiveSubtitleBackgroundOpacity(preset)
}

export function subtitlePositionName(position: SubtitlePosition): keyof typeof SUBTITLE_POSITIONS | "custom" {
  return (Object.keys(SUBTITLE_POSITIONS) as (keyof typeof SUBTITLE_POSITIONS)[]).find(name =>
    Math.abs(position.x - SUBTITLE_POSITIONS[name].x) < 0.5 && Math.abs(position.y - SUBTITLE_POSITIONS[name].y) < 0.5,
  ) ?? "custom"
}

/** Relative sizes are a percentage of the displayed video's shorter side. */
export function resolveSubtitleFontSize(style: SubtitleStyle, videoWidth = 640, videoHeight = videoWidth * 9 / 16): number {
  const width = Number.isFinite(videoWidth) && videoWidth > 0 ? videoWidth : 640
  const height = Number.isFinite(videoHeight) && videoHeight > 0 ? videoHeight : width * 9 / 16
  return style.relativeFontSize * Math.min(width, height) / 100
}

/** Exclude contain/scale-down letterboxing while leaving caption positioning unchanged. */
export function subtitleVideoSize(video: HTMLVideoElement, rect = video.getBoundingClientRect()) {
  const size = { width: rect.width, height: rect.height }
  if (video.videoWidth <= 0 || video.videoHeight <= 0 || rect.width <= 0 || rect.height <= 0)
    return size
  const fit = video.ownerDocument.defaultView?.getComputedStyle(video).objectFit
  if (fit !== "contain" && fit !== "scale-down")
    return size
  const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight, fit === "scale-down" ? 1 : Number.POSITIVE_INFINITY)
  return { width: video.videoWidth * scale, height: video.videoHeight * scale }
}

/** Shared presentation for the settings preview and the in-video renderer. */
export function subtitleTextStyle(style: SubtitleStyle, videoWidth = 640, videoHeight = videoWidth * 9 / 16) {
  const ink = style.preset === "ink"
  const modern = (SUBTITLE_PRESETS as readonly SubtitleStyle["preset"][]).includes(style.preset)
  const hasBackground = effectiveSubtitleBackgroundOpacity(style) > 0
  return {
    "--readomi-original-font-scale": `${style.originalFontScale / 100}em`,
    "--readomi-translation-font": TRANSLATION_FONT_FAMILIES[style.translationFont],
    "--readomi-translation-color": style.translationColor,
    "--readomi-translation-letter-spacing": style.translationFont === "serif" ? "0.04em" : "0",
    "--readomi-original-color": ink ? "#d1dcdf" : style.preset === "gold" ? "#fff7e9" : "#fff",
    "--readomi-original-weight": ink ? "400" : style.preset === "gold" ? "500" : "600",
    "--readomi-original-gap": modern ? ink ? "0.35em" : "0.22em" : "4px",
    "fontSize": `${resolveSubtitleFontSize(style, videoWidth, videoHeight)}px`,
    "fontWeight": ink || style.preset === "compact" ? "500" : "600",
    "color": "#fff",
    "textAlign": ink ? "left" as const : "center" as const,
    "whiteSpace": "pre-line" as const,
    "textShadow": ink && hasBackground ? "none" : modern ? "0 2px 4px #0008" : "0 2px 4px #000,0 0 2px #000",
    "WebkitTextStroke": modern && !(ink && hasBackground) ? "0.075em #17201ccc" : "0",
    "paintOrder": "stroke fill",
    "lineHeight": "1.4",
    "background": style.backgroundEnabled ? `rgba(${ink ? "16,25,27" : "15,20,35"},${style.backgroundOpacity / 100})` : "transparent",
    "borderRadius": style.backgroundEnabled ? ink ? "0.4em" : "8px" : "0",
    "padding": style.backgroundEnabled ? ink ? "0.6em 0.9em" : style.preset === "compact" ? "8px 14px" : "10px 16px" : "0",
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
