import type { ReactNode } from "react"
import type { SubtitlePosition, SubtitleStyle } from "@/types/config/subtitle-style"
import { useAtom, useSetAtom } from "jotai"
import { useEffect, useLayoutEffect, useRef } from "react"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { SUBTITLE_FONT_SIZE_MODES, SUBTITLE_PRESETS } from "@/types/config/subtitle-style"
import { configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { effectiveSubtitleBackgroundOpacity, formatSubtitleFontSize, isSubtitlePresetModified, resolveSubtitleFontSize, resolveSubtitlePosition, SUBTITLE_POSITIONS, subtitleBackgroundPatch, subtitlePositionName, subtitlePresetPatch, subtitleSizePatch, subtitleSizeSettings, subtitleTextStyle } from "@/utils/subtitles/appearance"
import { bindSubtitleDrag } from "@/utils/subtitles/drag"
import { SettingsGroup, SettingsRow } from "../../components/settings-section"
import { SettingsSlider } from "../../components/settings-slider"
import "./subtitle-style-editor.css"

export function SubtitleStyleEditor({ children, footer }: { children: ReactNode, footer?: ReactNode }) {
  const [features] = useAtom(configFieldsAtomMap.features)
  const setConfig = useSetAtom(writeConfigAtom)
  const setStyle = (patch: Partial<SubtitleStyle>) => void setConfig({ features: { subtitleStyle: patch } })
  const style = features.subtitleStyle
  const size = subtitleSizeSettings(style)
  const modified = isSubtitlePresetModified(style)
  const position = subtitlePositionName(style.position)
  const depth = effectiveSubtitleBackgroundOpacity(style)
  const backgroundSummary = depth ? i18n.t("subtitleStyle.backgroundSummary", [depth]) : i18n.t("subtitleStyle.noBackground")
  const commonSizes = style.fontSizeMode === "video" ? [2.5, 3, 3.75, 4.5] : [16, 20, 24, 28]
  const positions = Object.keys(SUBTITLE_POSITIONS) as (keyof typeof SUBTITLE_POSITIONS)[]
  const frameRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef(style)
  const dragPositionRef = useRef<SubtitlePosition | null>(null)

  useLayoutEffect(() => {
    styleRef.current = style
    const place = () => {
      if (!frameRef.current || !previewRef.current || !captionRef.current)
        return
      const frame = frameRef.current
      const caption = captionRef.current
      caption.style.fontSize = `${resolveSubtitleFontSize(style, previewRef.current.getBoundingClientRect().width)}px`
      const captionRect = caption.getBoundingClientRect()
      // Keep the real font size readable even when the bilingual sample exceeds 16:9.
      frame.style.minHeight = `${Math.ceil(captionRect.height + 24)}px`
      const rect = previewRef.current.getBoundingClientRect()
      const next = resolveSubtitlePosition(dragPositionRef.current ?? style.position, rect, captionRect)
      captionRef.current.style.left = `${next.x}%`
      captionRef.current.style.top = `${next.y}%`
    }
    place()
    if (typeof ResizeObserver === "undefined")
      return
    const observer = new ResizeObserver(place)
    observer.observe(frameRef.current!)
    observer.observe(captionRef.current!)
    return () => observer.disconnect()
  }, [style, features.subtitleMode])

  useEffect(() => {
    const caption = captionRef.current
    const preview = previewRef.current
    if (!caption || !preview)
      return
    const move = (next: SubtitlePosition) => {
      dragPositionRef.current = next
      caption.style.left = `${next.x}%`
      caption.style.top = `${next.y}%`
    }
    return bindSubtitleDrag(caption, {
      videoRect: () => preview.getBoundingClientRect(),
      position: () => dragPositionRef.current ?? {
        x: Number.parseFloat(caption.style.left),
        y: Number.parseFloat(caption.style.top),
      },
      move,
      commit: (next) => {
        dragPositionRef.current = null
        void setConfig({ features: { subtitleStyle: { position: next } } })
      },
      cancel: () => {
        const saved = styleRef.current
        move(resolveSubtitlePosition(saved.position, preview.getBoundingClientRect(), caption.getBoundingClientRect()))
        dragPositionRef.current = null
      },
    })
  }, [setConfig])

  return (
    <div className="options-two-column subtitle-settings-layout">
      <div className="options-controls">
        <SettingsGroup caption={i18n.t("subtitleStyle.controlsTitle")} className="subtitle-settings-group">
          {children}
          <SettingsRow
            className="subtitle-mode-row"
            label={i18n.t("subtitleStyle.fontSizeMode")}
            control={(
              <SegmentedControl
                aria-label={i18n.t("subtitleStyle.fontSizeMode")}
                size="sm"
                value={style.fontSizeMode}
                options={SUBTITLE_FONT_SIZE_MODES.map(value => ({ value, label: i18n.t(`subtitleStyle.fontSizeModes.${value}`) }))}
                onChange={fontSizeMode => setStyle({ fontSizeMode })}
              />
            )}
          >
            <p className="subtitle-control-help">{i18n.t(style.fontSizeMode === "video" ? "subtitleStyle.relativeFontDescription" : "subtitleStyle.fixedFontDescription")}</p>
          </SettingsRow>
          <SettingsRow
            label={i18n.t("subtitleStyle.preset")}
            control={<span className="subtitle-adjusted-label" data-modified={modified} aria-hidden={!modified}>{i18n.t("subtitleStyle.modified")}</span>}
          >
            <div className="subtitle-preset-list" role="group" aria-label={i18n.t("subtitleStyle.preset")}>
              {SUBTITLE_PRESETS.map((preset) => {
                const candidate = { ...style, ...subtitlePresetPatch(preset) }
                const candidateDepth = effectiveSubtitleBackgroundOpacity(candidate)
                return (
                  <button
                    type="button"
                    key={preset}
                    className="subtitle-preset-option"
                    aria-label={i18n.t(`subtitleStyle.presets.${preset}`)}
                    aria-pressed={style.preset === preset && !modified}
                    onClick={() => setStyle(subtitlePresetPatch(preset))}
                  >
                    <strong>{i18n.t(`subtitleStyle.presets.${preset}`)}</strong>
                    <span>
                      {formatSubtitleFontSize(candidate)}
                      {" · "}
                      {candidateDepth ? i18n.t("subtitleStyle.backgroundSummary", [candidateDepth]) : i18n.t("subtitleStyle.noBackground")}
                    </span>
                  </button>
                )
              })}
            </div>
          </SettingsRow>
          <details className="subtitle-custom">
            <summary className="subtitle-disclosure-summary" aria-label={i18n.t("subtitleStyle.customDescription")}>
              <span>{i18n.t("subtitleStyle.custom")}</span>
              <span className="subtitle-custom-values">
                {formatSubtitleFontSize(style)}
                {" · "}
                {backgroundSummary}
                <span className="subtitle-custom-position">{` · ${i18n.t(`subtitleStyle.positions.${position}`)}`}</span>
              </span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 6 5 5 5-5" /></svg>
            </summary>
            <div className="subtitle-custom-content">
              <SettingsRow
                className="subtitle-font-row"
                label={i18n.t("subtitleStyle.fontSize")}
                control={(
                  <div className="subtitle-common-sizes" role="group" aria-label={i18n.t("subtitleStyle.commonSizes")}>
                    {commonSizes.map(value => (
                      <button type="button" key={value} aria-pressed={Math.abs(size.value - value) < 1e-9} onClick={() => setStyle(subtitleSizePatch(style, value))}>
                        {`${value}${size.unit === "%" ? "%" : " px"}`}
                      </button>
                    ))}
                  </div>
                )}
              >
                <SettingsSlider
                  key={style.fontSizeMode}
                  className="subtitle-precise-slider"
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
              <SettingsRow label={i18n.t("subtitleStyle.backgroundOpacity")} control={<output className="subtitle-depth-value">{`${depth}%`}</output>}>
                <SettingsSlider
                  className="subtitle-precise-slider"
                  min={0}
                  max={100}
                  step={1}
                  aria-label={i18n.t("subtitleStyle.backgroundOpacity")}
                  value={depth}
                  unit="%"
                  showLimits={false}
                  decrementLabel={i18n.t("subtitleStyle.lighterBackground")}
                  incrementLabel={i18n.t("subtitleStyle.darkerBackground")}
                  onValueChange={value => setStyle(subtitleBackgroundPatch(value))}
                />
                <p className="subtitle-control-help">{i18n.t("subtitleStyle.backgroundZeroDescription")}</p>
              </SettingsRow>
              <SettingsRow
                label={i18n.t("subtitleStyle.position")}
                control={<button type="button" className="subtitle-position-reset" aria-label={i18n.t("subtitleStyle.resetPosition")} onClick={() => setStyle({ position: SUBTITLE_POSITIONS.bottom })}>{i18n.t("subtitleStyle.resetPositionShort")}</button>}
              >
                <SegmentedControl
                  aria-label={i18n.t("subtitleStyle.position")}
                  size="sm"
                  className="subtitle-position-options"
                  value={position}
                  options={positions.map(value => ({ value, label: i18n.t(`subtitleStyle.positions.${value}`) }))}
                  onChange={value => setStyle({ position: SUBTITLE_POSITIONS[value as keyof typeof SUBTITLE_POSITIONS] })}
                />
                <p className="subtitle-control-help">{i18n.t("subtitleStyle.dragHint")}</p>
              </SettingsRow>
            </div>
          </details>
        </SettingsGroup>
        {footer && (
          <details className="subtitle-site-more">
            <summary className="subtitle-disclosure-summary">
              <span>{i18n.t("subtitleStyle.moreOptions")}</span>
              <span className="subtitle-custom-values">{i18n.t("videoSiteRules.title")}</span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 6 5 5 5-5" /></svg>
            </summary>
            {footer}
          </details>
        )}
      </div>
      <aside className="options-preview-column">
        <h3 className="options-preview-title">{i18n.t("subtitleStyle.preview")}</h3>
        <div ref={frameRef} aria-label={i18n.t("subtitleStyle.preview")} className="relative aspect-video overflow-hidden rounded-xl border border-border">
          <div ref={previewRef} className="subtitle-preview-scene absolute inset-0 h-full w-full">
            <div
              ref={captionRef}
              role="group"
              tabIndex={0}
              aria-label={i18n.t("subtitleStyle.previewDragLabel")}
              className="subtitle-preview-caption absolute w-max -translate-x-1/2 -translate-y-full"
              style={{ ...subtitleTextStyle(style), maxWidth: "calc(100% - 16px)", padding: "4px 7px", borderRadius: "5px", left: `${style.position.x}%`, top: `${style.position.y}%` }}
            >
              {features.subtitleMode === "bilingual" && <div className="text-[.82em]">{i18n.t("subtitleStyle.previewOriginal")}</div>}
              <div>{i18n.t("subtitleStyle.previewTranslation")}</div>
            </div>
          </div>
        </div>
        <p className="subtitle-control-help subtitle-preview-help">{i18n.t("subtitleStyle.previewDragHint")}</p>
        <p className="subtitle-preview-summary">
          {i18n.t(`subtitleStyle.presets.${style.preset}`)}
          {modified && ` (${i18n.t("subtitleStyle.modified")})`}
          {` · ${formatSubtitleFontSize(style)} · ${backgroundSummary} · ${i18n.t(`subtitleStyle.positions.${position}`)}`}
        </p>
      </aside>
    </div>
  )
}
