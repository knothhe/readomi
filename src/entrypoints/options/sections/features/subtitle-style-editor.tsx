import type { ReactNode } from "react"
import { useAtom } from "jotai"
import { useLayoutEffect, useRef } from "react"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_FONT_SIZE_MAX, SUBTITLE_FONT_SIZE_MIN, SUBTITLE_FONT_SIZE_MODES, SUBTITLE_PRESETS } from "@/types/config/subtitle-style"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { resolveSubtitleFontSize, resolveSubtitlePosition, SUBTITLE_POSITIONS, subtitlePositionName, subtitlePresetPatch, subtitleTextStyle } from "@/utils/subtitles/appearance"
import { SettingsGroup, SettingsRow } from "../../components/settings-section"
import { SettingsSlider } from "../../components/settings-slider"

export function SubtitleStyleEditor({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const style = features.subtitleStyle
  const position = subtitlePositionName(style.position)
  const frameRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const place = () => {
      if (!frameRef.current || !previewRef.current || !captionRef.current)
        return
      const rect = previewRef.current.getBoundingClientRect()
      captionRef.current.style.fontSize = `${resolveSubtitleFontSize(style, rect.width)}px`
      const next = resolveSubtitlePosition(style.position, rect, captionRef.current.getBoundingClientRect())
      captionRef.current.style.left = `${next.x}%`
      captionRef.current.style.top = `${next.y}%`
    }
    place()
    if (typeof ResizeObserver === "undefined")
      return
    const observer = new ResizeObserver(place)
    if (frameRef.current)
      observer.observe(frameRef.current)
    if (captionRef.current)
      observer.observe(captionRef.current)
    return () => observer.disconnect()
  }, [style, features.subtitleMode])
  const positions = Object.keys(SUBTITLE_POSITIONS) as (keyof typeof SUBTITLE_POSITIONS)[]

  return (
    <div className="options-two-column">
      <div className="options-controls">
        {children}
        <SettingsGroup caption={i18n.t("subtitleStyle.title")}>
          <SettingsRow
            label={i18n.t("subtitleStyle.preset")}
            control={(
              <SegmentedControl
                aria-label={i18n.t("subtitleStyle.preset")}
                size="sm"
                value={style.preset}
                options={SUBTITLE_PRESETS.map(value => ({ value, label: i18n.t(`subtitleStyle.presets.${value}`) }))}
                onChange={preset => void setFeatures({ subtitleStyle: { ...style, ...subtitlePresetPatch(preset, style.fontSizeMode) } })}
              />
            )}
          />
          <SettingsRow
            label={i18n.t("subtitleStyle.fontSizeMode")}
            control={(
              <SegmentedControl
                aria-label={i18n.t("subtitleStyle.fontSizeMode")}
                size="sm"
                value={style.fontSizeMode}
                options={SUBTITLE_FONT_SIZE_MODES.map(value => ({ value, label: i18n.t(`subtitleStyle.fontSizeModes.${value}`) }))}
                onChange={fontSizeMode => void setFeatures({ subtitleStyle: { ...style, fontSizeMode } })}
              />
            )}
          />
          <SettingsRow label={i18n.t("subtitleStyle.fontSize")} description={i18n.t(style.fontSizeMode === "video" ? "subtitleStyle.relativeFontDescription" : "subtitleStyle.fontDescription")}>
            <SettingsSlider
              min={SUBTITLE_FONT_SIZE_MIN}
              max={SUBTITLE_FONT_SIZE_MAX}
              step={1}
              aria-label={i18n.t("subtitleStyle.fontSize")}
              value={style.fontSize}
              unit="px"
              decrementLabel={i18n.t("subtitleStyle.smaller")}
              incrementLabel={i18n.t("subtitleStyle.larger")}
              onValueChange={fontSize => void setFeatures({ subtitleStyle: { ...style, fontSize } })}
            />
          </SettingsRow>
          <SettingsRow
            label={i18n.t("subtitleStyle.position")}
            description={position === "custom" ? i18n.t("subtitleStyle.positions.custom") : undefined}
            control={(
              <SegmentedControl
                aria-label={i18n.t("subtitleStyle.position")}
                size="sm"
                value={position}
                options={positions.map(value => ({ value, label: i18n.t(`subtitleStyle.positions.${value}`) }))}
                onChange={value => void setFeatures({ subtitleStyle: { ...style, position: SUBTITLE_POSITIONS[value as keyof typeof SUBTITLE_POSITIONS] } })}
              />
            )}
          />
        </SettingsGroup>
        <div className="flex flex-col items-start gap-3">
          <button type="button" className="flex items-center gap-1.5 rounded-md py-1 text-xs text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => void setFeatures({ subtitleStyle: DEFAULT_SUBTITLE_STYLE })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-3.5"><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" /></svg>
            {i18n.t("subtitleStyle.reset")}
          </button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{i18n.t("subtitleStyle.adjustmentHint")}</p>
        </div>
      </div>
      <aside className="options-preview-column">
        <h3 className="options-preview-title">{i18n.t("subtitleStyle.preview")}</h3>
        <div ref={frameRef} aria-label={i18n.t("subtitleStyle.preview")} className="relative aspect-video overflow-hidden rounded-xl border border-border">
          <div ref={previewRef} className="subtitle-preview-scene absolute inset-0 h-full w-full">
            <div aria-hidden="true" className="absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white/80">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-6">
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="m10 9 5 3-5 3Z" />
              </svg>
            </div>
            <div
              ref={captionRef}
              className="absolute w-max max-w-[80%] -translate-x-1/2 -translate-y-full"
              style={{ ...subtitleTextStyle(style), left: `${style.position.x}%`, top: `${style.position.y}%` }}
            >
              {features.subtitleMode === "bilingual" && <div className="mb-1 text-[.85em]">{i18n.t("subtitleStyle.previewOriginal")}</div>}
              <div>{i18n.t("subtitleStyle.previewTranslation")}</div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
