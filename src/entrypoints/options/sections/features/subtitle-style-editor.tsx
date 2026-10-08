import type { ReactNode } from "react"
import type { SubtitlePosition, SubtitleStyle } from "@/types/config/subtitle-style"
import { useAtom, useSetAtom } from "jotai"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { SUBTITLE_DEFAULT_SIZE_BASIS, SUBTITLE_PRESETS } from "@/types/config/subtitle-style"
import { configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { effectiveSubtitleBackgroundOpacity, formatSubtitleFontSize, isSubtitlePresetModified, resolveSubtitleFontSize, resolveSubtitlePosition, SUBTITLE_POSITIONS, subtitleBackgroundPatch, subtitlePositionName, subtitlePresetPatch, subtitleSizePatch, subtitleSizeSettings, subtitleTextStyle } from "@/utils/subtitles/appearance"
import { bindSubtitleDrag } from "@/utils/subtitles/drag"
import { SettingsGroup, SettingsRow } from "../../components/settings-section"
import { SettingsSlider } from "../../components/settings-slider"
import { SubtitleOriginalSizeControl } from "./subtitle-original-size-control"
import { SubtitleTranslationStyleControls } from "./subtitle-translation-style-controls"
import "./subtitle-style-editor.css"

const PREVIEW_ASPECT_RATIOS = { landscape: 9 / 16, portrait: 16 / 9, square: 1 } as const
const PREVIEW_SHORT_SIDE = 720

export function SubtitleStyleEditor({ children, footer }: { children: ReactNode, footer?: ReactNode }) {
  const [features] = useAtom(configFieldsAtomMap.features)
  const setConfig = useSetAtom(writeConfigAtom)
  const setStyle = (patch: Partial<SubtitleStyle>) => void setConfig({ features: { subtitleStyle: patch } })
  const [originalFontScaleDraft, setOriginalFontScaleDraft] = useState<number | null>(null)
  const [originalFontScaleFailed, setOriginalFontScaleFailed] = useState(false)
  const originalFontScaleWriteRef = useRef(0)
  const style = useMemo(() => originalFontScaleDraft === null ? features.subtitleStyle : { ...features.subtitleStyle, originalFontScale: originalFontScaleDraft }, [features.subtitleStyle, originalFontScaleDraft])
  const setOriginalFontScale = (originalFontScale: number) => {
    const version = ++originalFontScaleWriteRef.current
    setOriginalFontScaleDraft(originalFontScale)
    setOriginalFontScaleFailed(false)
    void setConfig({ features: { subtitleStyle: { originalFontScale } } }).then(() => {
      if (version === originalFontScaleWriteRef.current)
        setOriginalFontScaleDraft(null)
    }).catch(() => {
      if (version === originalFontScaleWriteRef.current)
        setOriginalFontScaleFailed(true)
    })
  }
  const size = subtitleSizeSettings(style)
  const modified = isSubtitlePresetModified(style)
  const position = subtitlePositionName(style.position)
  const depth = effectiveSubtitleBackgroundOpacity(style)
  const backgroundSummary = depth ? i18n.t("subtitleStyle.backgroundSummary", [depth]) : i18n.t("subtitleStyle.noBackground")
  const commonSizes = [80, 100, 125, 150]
  const positions = Object.keys(SUBTITLE_POSITIONS) as (keyof typeof SUBTITLE_POSITIONS)[]
  const [previewAspect, setPreviewAspect] = useState<keyof typeof PREVIEW_ASPECT_RATIOS>("landscape")
  const [previewSample, setPreviewSample] = useState<"short" | "long">("short")
  const previewOverflowRef = useRef<HTMLParagraphElement>(null)
  const previewScaleRef = useRef(1)
  const fontSizeOutputRef = useRef<HTMLOutputElement>(null)
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
      const width = previewAspect === "landscape" ? PREVIEW_SHORT_SIDE * 16 / 9 : PREVIEW_SHORT_SIDE
      const height = width * PREVIEW_ASPECT_RATIOS[previewAspect]
      const scale = (frame.clientWidth || frame.getBoundingClientRect().width || width) / width
      previewScaleRef.current = scale
      const preview = previewRef.current
      preview.style.width = `${width}px`
      preview.style.height = `${height}px`
      preview.style.transform = `scale(${scale})`
      // Render the reference player first, then shrink its text and decoration together.
      const fontSize = resolveSubtitleFontSize(style, width, height)
      caption.style.fontSize = `${fontSize}px`
      if (fontSizeOutputRef.current) {
        fontSizeOutputRef.current.textContent = features.subtitleMode === "bilingual"
          ? i18n.t("subtitleStyle.previewBilingualFontSize", [Number((fontSize * scale * style.originalFontScale / 100).toFixed(2)), Number((fontSize * scale).toFixed(2))])
          : i18n.t("subtitleStyle.previewTranslatedFontSize", [Number((fontSize * scale).toFixed(2))])
      }
      const captionRect = caption.getBoundingClientRect()
      const captionSize = { width: captionRect.width / scale, height: captionRect.height / scale }
      if (previewOverflowRef.current)
        previewOverflowRef.current.hidden = captionSize.height <= height && captionSize.width <= width
      const next = resolveSubtitlePosition(dragPositionRef.current ?? style.position, { width, height }, captionSize)
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
  }, [style, features.subtitleMode, previewAspect, previewSample])

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
      geometryScale: () => previewScaleRef.current,
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
        const scale = previewScaleRef.current
        const video = preview.getBoundingClientRect()
        const captionRect = caption.getBoundingClientRect()
        move(resolveSubtitlePosition(saved.position, { width: video.width / scale, height: video.height / scale }, { width: captionRect.width / scale, height: captionRect.height / scale }))
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
            label={i18n.t("subtitleStyle.preset")}
            control={<span className="subtitle-adjusted-label" data-modified={modified} aria-hidden={!modified}>{i18n.t("subtitleStyle.modified")}</span>}
          >
            <div className="subtitle-preset-list" role="group" aria-label={i18n.t("subtitleStyle.preset")}>
              {SUBTITLE_PRESETS.map((preset) => {
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
                      {i18n.t(`subtitleStyle.presetSummaries.${preset}`)}
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
                {i18n.t("subtitleStyle.originalFontScaleSummary", [style.originalFontScale])}
                {" · "}
                {i18n.t(`subtitleStyle.translationFonts.${style.translationFont}`)}
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
                      <button type="button" key={value} aria-pressed={Math.abs(size.value - value) < 1e-9} onClick={() => setStyle(subtitleSizePatch(value))}>
                        {`${value}%`}
                      </button>
                    ))}
                  </div>
                )}
              >
                <p className="subtitle-control-help">{i18n.t("subtitleStyle.relativeFontDescription")}</p>
                <SettingsSlider
                  allowDecimal
                  className="subtitle-precise-slider"
                  min={size.min}
                  max={size.max}
                  step={size.step}
                  aria-label={i18n.t("subtitleStyle.fontSize")}
                  value={style.relativeFontSize * (100 / SUBTITLE_DEFAULT_SIZE_BASIS)}
                  displayValue={size.value}
                  unit={size.unit}
                  showLimits={false}
                  decrementLabel={i18n.t("subtitleStyle.smaller")}
                  incrementLabel={i18n.t("subtitleStyle.larger")}
                  onValueChange={value => setStyle(subtitleSizePatch(value))}
                />
              </SettingsRow>
              <SubtitleOriginalSizeControl
                value={style.originalFontScale}
                savedValue={features.subtitleStyle.originalFontScale}
                disabled={features.subtitleMode === "translationOnly"}
                failed={originalFontScaleFailed}
                onChange={setOriginalFontScale}
                onRetry={() => setOriginalFontScale(style.originalFontScale)}
              />
              <SubtitleTranslationStyleControls style={style} onChange={setStyle} />
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
        <div className="subtitle-preview-controls">
          <SegmentedControl
            aria-label={i18n.t("subtitleStyle.previewAspectRatio")}
            className="subtitle-preview-aspects"
            size="sm"
            value={previewAspect}
            options={(Object.keys(PREVIEW_ASPECT_RATIOS) as (keyof typeof PREVIEW_ASPECT_RATIOS)[]).map(value => ({ value, label: i18n.t(`subtitleStyle.previewAspectRatios.${value}`) }))}
            onChange={setPreviewAspect}
          />
          <SegmentedControl
            aria-label={i18n.t("subtitleStyle.previewSample")}
            size="sm"
            value={previewSample}
            options={(["short", "long"] as const).map(value => ({ value, label: i18n.t(`subtitleStyle.previewSamples.${value}`) }))}
            onChange={setPreviewSample}
          />
        </div>
        <div
          ref={frameRef}
          aria-label={i18n.t("subtitleStyle.preview")}
          className="subtitle-preview-frame relative overflow-hidden rounded-xl border border-border"
          data-aspect={previewAspect}
          style={{ aspectRatio: `1 / ${PREVIEW_ASPECT_RATIOS[previewAspect]}` }}
        >
          <div ref={previewRef} className="subtitle-preview-scene absolute left-0 top-0">
            <div
              ref={captionRef}
              role="group"
              tabIndex={0}
              aria-label={i18n.t("subtitleStyle.previewDragLabel")}
              className="subtitle-preview-caption absolute w-max -translate-x-1/2 -translate-y-full"
              style={{ ...subtitleTextStyle(style), maxWidth: "80%", left: `${style.position.x}%`, top: `${style.position.y}%` }}
            >
              {features.subtitleMode === "bilingual" && <div className="subtitle-preview-original">{i18n.t(previewSample === "short" ? "subtitleStyle.previewOriginal" : "subtitleStyle.previewLongOriginal")}</div>}
              <div className="subtitle-preview-translated">{i18n.t(previewSample === "short" ? "subtitleStyle.previewTranslation" : "subtitleStyle.previewLongTranslation")}</div>
            </div>
          </div>
        </div>
        <output ref={fontSizeOutputRef} className="subtitle-control-help subtitle-preview-size" />
        <p className="subtitle-control-help">{i18n.t("subtitleStyle.previewScaleHint")}</p>
        <p ref={previewOverflowRef} className="subtitle-preview-overflow" role="status" hidden>{i18n.t("subtitleStyle.previewOverflow")}</p>
        <p className="subtitle-control-help subtitle-preview-help">{i18n.t("subtitleStyle.previewDragHint")}</p>
        <p className="subtitle-preview-summary">
          {i18n.t(`subtitleStyle.presets.${style.preset}`)}
          {modified && ` (${i18n.t("subtitleStyle.modified")})`}
          {` · ${formatSubtitleFontSize(style)} · ${i18n.t("subtitleStyle.originalFontScaleSummary", [style.originalFontScale])} · ${i18n.t(`subtitleStyle.translationFonts.${style.translationFont}`)} · ${style.translationColor.toUpperCase()} · ${backgroundSummary} · ${i18n.t(`subtitleStyle.positions.${position}`)}`}
        </p>
      </aside>
    </div>
  )
}
