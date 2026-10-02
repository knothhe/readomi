import { useAtom } from "jotai"
import { useLayoutEffect, useRef } from "react"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_PRESETS } from "@/types/config/subtitle-style"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { cn } from "@/utils/styles/utils"
import { resolveSubtitlePosition, SUBTITLE_POSITIONS, subtitlePositionName, subtitlePresetPatch, subtitleTextStyle } from "@/utils/subtitles/appearance"
import { SettingsGroup, SettingsRow } from "../../components/settings-section"

export function SubtitleStyleEditor() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const style = features.subtitleStyle
  const position = subtitlePositionName(style.position)
  const previewRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const place = () => {
      if (!previewRef.current || !captionRef.current)
        return
      const next = resolveSubtitlePosition(style.position, previewRef.current.getBoundingClientRect(), captionRef.current.getBoundingClientRect())
      captionRef.current.style.left = `${next.x}%`
      captionRef.current.style.top = `${next.y}%`
    }
    place()
    if (typeof ResizeObserver === "undefined")
      return
    const observer = new ResizeObserver(place)
    if (previewRef.current)
      observer.observe(previewRef.current)
    if (captionRef.current)
      observer.observe(captionRef.current)
    return () => observer.disconnect()
  }, [style, features.subtitleMode])
  const positions = Object.keys(SUBTITLE_POSITIONS) as (keyof typeof SUBTITLE_POSITIONS)[]

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[15px] font-semibold">{i18n.t("subtitleStyle.title")}</h3>
      <div ref={previewRef} aria-label={i18n.t("subtitleStyle.preview")} className="relative aspect-video overflow-hidden rounded-xl bg-linear-to-br from-[#342b38] to-[#252c38]">
        <div
          ref={captionRef}
          className="absolute w-max max-w-[80%] -translate-x-1/2 -translate-y-full"
          style={{ ...subtitleTextStyle(style), left: `${style.position.x}%`, top: `${style.position.y}%` }}
        >
          {features.subtitleMode === "bilingual" && <div className="mb-1 text-[.85em]">{i18n.t("subtitleStyle.previewOriginal")}</div>}
          <div>{i18n.t("subtitleStyle.previewTranslation")}</div>
        </div>
      </div>
      <SettingsGroup>
        <SettingsRow label={i18n.t("subtitleStyle.preset")}>
          <div role="group" aria-label={i18n.t("subtitleStyle.preset")} className="grid grid-cols-3 gap-2">
            {SUBTITLE_PRESETS.map(preset => (
              <button
                key={preset}
                type="button"
                aria-pressed={style.preset === preset}
                onClick={() => void setFeatures({ subtitleStyle: { ...style, ...subtitlePresetPatch(preset) } })}
                className={cn("flex flex-col items-center gap-2 rounded-lg border px-2 py-2.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50", style.preset === preset ? "border-brand bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted")}
              >
                <span aria-hidden="true" className="flex h-16 w-full items-center justify-center rounded-md bg-[#302b29]">
                  <span style={{ ...subtitleTextStyle({ ...style, ...subtitlePresetPatch(preset) }), fontSize: preset === "study" ? "18px" : "13px", padding: "4px 12px" }}>
                    Aa
                    <br />
                    文
                  </span>
                </span>
                {i18n.t(`subtitleStyle.presets.${preset}`)}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          label={i18n.t("subtitleStyle.fontSize")}
          description={i18n.t("subtitleStyle.fontDescription")}
          control={(
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="14"
                max="40"
                step="1"
                aria-label={i18n.t("subtitleStyle.fontSize")}
                className="w-28 accent-brand sm:w-44"
                value={style.fontSize}
                onChange={e => void setFeatures({ subtitleStyle: { ...style, fontSize: Number(e.target.value) } })}
              />
              <output className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                {style.fontSize}
                {" "}
                px
              </output>
            </div>
          )}
        />
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
        <SettingsRow
          label={<span className="block max-w-md text-xs leading-relaxed font-normal text-muted-foreground">{i18n.t("subtitleStyle.adjustmentHint")}</span>}
          control={<button type="button" className="rounded-md border border-input bg-card px-3 py-1.5 text-xs hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => void setFeatures({ subtitleStyle: DEFAULT_SUBTITLE_STYLE })}>{i18n.t("subtitleStyle.reset")}</button>}
        />
      </SettingsGroup>
    </div>
  )
}
