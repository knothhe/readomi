import type { ReactNode } from "react"
import type { SubtitleStyle } from "@/types/config/subtitle-style"
import { useAtom, useSetAtom } from "jotai"
import { useLayoutEffect, useRef } from "react"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { Switch } from "@/components/ui/switch"
import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_FONT_SIZE_MODES, SUBTITLE_PRESETS } from "@/types/config/subtitle-style"
import { configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { formatSubtitleFontSize, isSubtitlePresetModified, resolveSubtitleFontSize, resolveSubtitlePosition, SUBTITLE_POSITIONS, subtitlePositionName, subtitlePresetPatch, subtitleSizePatch, subtitleSizeSettings, subtitleTextStyle } from "@/utils/subtitles/appearance"
import { SettingsGroup, SettingsRow } from "../../components/settings-section"
import { SettingsSlider } from "../../components/settings-slider"

export function SubtitleStyleEditor({ children, footer }: { children: ReactNode, footer?: ReactNode }) {
  const [features] = useAtom(configFieldsAtomMap.features)
  const setConfig = useSetAtom(writeConfigAtom)
  const setStyle = (patch: Partial<SubtitleStyle>) => void setConfig({ features: { subtitleStyle: patch } })
  const style = features.subtitleStyle
  const size = subtitleSizeSettings(style)
  const modified = isSubtitlePresetModified(style)
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
        <SettingsGroup caption={i18n.t("subtitleStyle.title")} className="subtitle-style-group">
          <SettingsRow
            label={i18n.t("subtitleStyle.preset")}
            control={modified && <span className="subtitle-preset-adjusted">{i18n.t("subtitleStyle.modified")}</span>}
          >
            <div className="subtitle-presets" role="group" aria-label={i18n.t("subtitleStyle.preset")}>
              {SUBTITLE_PRESETS.map((preset) => {
                const candidate = { ...style, ...subtitlePresetPatch(preset, style.fontSizeMode) }
                return (
                  <button type="button" key={preset} className="subtitle-preset" aria-label={i18n.t(`subtitleStyle.presets.${preset}`)} aria-pressed={style.preset === preset && !modified} onClick={() => setStyle(subtitlePresetPatch(preset, style.fontSizeMode))}>
                    <strong>{i18n.t(`subtitleStyle.presets.${preset}`)}</strong>
                    <span>
                      {formatSubtitleFontSize(candidate)}
                      {" "}
                      ·
                      {" "}
                      {candidate.backgroundEnabled ? i18n.t("subtitleStyle.backgroundSummary", [candidate.backgroundOpacity]) : i18n.t("subtitleStyle.noBackground")}
                    </span>
                  </button>
                )
              })}
            </div>
          </SettingsRow>
          <SettingsRow
            className="subtitle-range-row"
            label={i18n.t("subtitleStyle.fontSize")}
            control={<span className="subtitle-size-mode" title={i18n.t(style.fontSizeMode === "video" ? "subtitleStyle.relativeFontDescription" : "subtitleStyle.fontDescription")}>{i18n.t(`subtitleStyle.fontSizeModes.${style.fontSizeMode}`)}</span>}
          >
            <SettingsSlider
              key={style.fontSizeMode}
              min={size.min}
              max={size.max}
              step={size.step}
              aria-label={i18n.t("subtitleStyle.fontSize")}
              value={size.value}
              unit={size.unit}
              showLimits={false}
              decrementLabel={i18n.t("subtitleStyle.smaller")}
              incrementLabel={i18n.t("subtitleStyle.larger")}
              onValueChange={value => setStyle(subtitleSizePatch(style, value))}
            />
          </SettingsRow>
          <SettingsRow label={i18n.t("subtitleStyle.background")} control={<Switch aria-label={i18n.t("subtitleStyle.background")} title={i18n.t("subtitleStyle.backgroundDescription")} checked={style.backgroundEnabled} onCheckedChange={backgroundEnabled => setStyle({ backgroundEnabled })} />}>
            {style.backgroundEnabled && (
              <div className="subtitle-background-depth">
                <span className="subtitle-depth-label" title={i18n.t("subtitleStyle.backgroundOpacityDescription")}>{i18n.t("subtitleStyle.backgroundOpacity")}</span>
                <SettingsSlider
                  min={0}
                  max={100}
                  step={5}
                  aria-label={i18n.t("subtitleStyle.backgroundOpacity")}
                  value={style.backgroundOpacity}
                  unit="%"
                  showLimits={false}
                  decrementLabel={i18n.t("subtitleStyle.lighterBackground")}
                  incrementLabel={i18n.t("subtitleStyle.darkerBackground")}
                  onValueChange={backgroundOpacity => setStyle({ backgroundOpacity })}
                />
              </div>
            )}
          </SettingsRow>
          <details className="subtitle-more">
            <summary className="subtitle-more-summary">
              <span>{i18n.t("subtitleStyle.moreOptions")}</span>
              <span className="subtitle-more-current">
                {i18n.t(`subtitleStyle.fontSizeModes.${style.fontSizeMode}`)}
                {" "}
                ·
                {" "}
                {i18n.t(`subtitleStyle.positions.${position}`)}
              </span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 6 5 5 5-5" /></svg>
            </summary>
            <div className="subtitle-more-content">
              <SettingsRow
                label={i18n.t("subtitleStyle.fontSizeMode")}
                description={i18n.t(style.fontSizeMode === "video" ? "subtitleStyle.relativeFontDescription" : "subtitleStyle.fontDescription")}
                control={(
                  <SegmentedControl
                    aria-label={i18n.t("subtitleStyle.fontSizeMode")}
                    size="sm"
                    value={style.fontSizeMode}
                    options={SUBTITLE_FONT_SIZE_MODES.map(value => ({ value, label: i18n.t(`subtitleStyle.fontSizeModes.${value}`) }))}
                    onChange={fontSizeMode => setStyle({ fontSizeMode })}
                  />
                )}
              />
              <SettingsRow
                label={i18n.t("subtitleStyle.position")}
                description={i18n.t("subtitleStyle.dragHint")}
                control={(
                  <SegmentedControl
                    aria-label={i18n.t("subtitleStyle.position")}
                    size="sm"
                    value={position}
                    options={positions.map(value => ({ value, label: i18n.t(`subtitleStyle.positions.${value}`) }))}
                    onChange={value => setStyle({ position: SUBTITLE_POSITIONS[value as keyof typeof SUBTITLE_POSITIONS] })}
                  />
                )}
              />
              <div className="subtitle-more-reset">
                <button type="button" className="flex items-center gap-1.5 rounded-md py-1 text-xs text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => setStyle(DEFAULT_SUBTITLE_STYLE)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-3.5"><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" /></svg>
                  {i18n.t("subtitleStyle.reset")}
                </button>
              </div>
            </div>
          </details>
        </SettingsGroup>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{i18n.t("subtitleStyle.autoSave")}</p>
        {footer}
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
