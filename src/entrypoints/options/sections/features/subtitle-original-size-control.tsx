import type { CSSProperties } from "react"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { SUBTITLE_ORIGINAL_FONT_SCALE_MAX, SUBTITLE_ORIGINAL_FONT_SCALE_MIN, SUBTITLE_ORIGINAL_FONT_SCALE_STEP } from "@/types/config/subtitle-style"
import { SettingsRow } from "../../components/settings-section"

export function SubtitleOriginalSizeControl({ value, disabled, failed, savedValue, onChange, onRetry }: {
  value: number
  disabled: boolean
  failed: boolean
  savedValue: number
  onChange: (value: number) => void
  onRetry: () => void
}) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const change = (next: number) => {
    setDraft(null)
    setInvalid(false)
    onChange(next)
  }
  const commit = () => {
    if (draft === null)
      return
    const parsed = Number(draft)
    if (draft.trim() === "" || !Number.isFinite(parsed) || parsed < SUBTITLE_ORIGINAL_FONT_SCALE_MIN || parsed > SUBTITLE_ORIGINAL_FONT_SCALE_MAX || parsed % SUBTITLE_ORIGINAL_FONT_SCALE_STEP !== 0) {
      setInvalid(true)
      return
    }
    change(parsed)
  }
  return (
    <SettingsRow
      className="subtitle-original-size-row"
      label={(
        <span>
          {i18n.t("subtitleStyle.originalFontScale")}
          <span className="subtitle-original-default">{i18n.t("subtitleStyle.originalFontScaleDefault")}</span>
        </span>
      )}
    >
      <p className="subtitle-control-help">
        {disabled ? i18n.t("subtitleStyle.originalFontScaleOnly", [value]) : i18n.t("subtitleStyle.originalFontScaleDescription")}
      </p>
      <div className="settings-slider subtitle-precise-slider" data-disabled={disabled || undefined}>
        <div className="settings-slider-controls">
          <input
            id={id}
            type="range"
            className="settings-slider-input"
            aria-label={i18n.t("subtitleStyle.originalFontScale")}
            aria-valuetext={`${value}%`}
            min={SUBTITLE_ORIGINAL_FONT_SCALE_MIN}
            max={SUBTITLE_ORIGINAL_FONT_SCALE_MAX}
            step={SUBTITLE_ORIGINAL_FONT_SCALE_STEP}
            value={value}
            disabled={disabled}
            style={{ "--settings-range-progress": `${value - SUBTITLE_ORIGINAL_FONT_SCALE_MIN}%` } as CSSProperties}
            onChange={event => change(Number(event.target.value))}
          />
          <div className="settings-slider-number">
            <input
              type="number"
              aria-label={i18n.t("subtitleStyle.originalFontScaleValue")}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-error` : undefined}
              min={SUBTITLE_ORIGINAL_FONT_SCALE_MIN}
              max={SUBTITLE_ORIGINAL_FONT_SCALE_MAX}
              step={SUBTITLE_ORIGINAL_FONT_SCALE_STEP}
              value={draft ?? value}
              disabled={disabled}
              onChange={(event) => {
                setDraft(event.target.value)
                setInvalid(false)
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  event.currentTarget.blur()
                if (event.key === "Escape") {
                  setDraft(null)
                  setInvalid(false)
                }
              }}
            />
            <span aria-hidden="true">%</span>
          </div>
        </div>
      </div>
      <div className="subtitle-common-sizes subtitle-original-presets" role="group" aria-label={i18n.t("subtitleStyle.originalFontScalePresets")}>
        {[85, 100, 125].map(ratio => (
          <button type="button" key={ratio} aria-pressed={value === ratio} disabled={disabled} onClick={() => change(ratio)}>
            {ratio === 100 ? "1:1" : `${ratio}%`}
          </button>
        ))}
      </div>
      {invalid && <p id={`${id}-error`} className="subtitle-original-error" role="alert">{i18n.t("subtitleStyle.originalFontScaleInvalid")}</p>}
      {disabled && <p className="subtitle-control-help">{i18n.t("subtitleStyle.originalFontScaleBilingualOnly")}</p>}
      {failed && (
        <div className="subtitle-original-save-error" role="alert">
          <strong>{i18n.t("subtitleStyle.originalFontScaleSaveFailed")}</strong>
          <p>{i18n.t("subtitleStyle.originalFontScaleSaveFailedDescription", [savedValue === 100 ? "1:1" : `${savedValue}%`])}</p>
          <button type="button" onClick={onRetry}>{i18n.t("subtitleStyle.originalFontScaleRetry")}</button>
        </div>
      )}
    </SettingsRow>
  )
}
