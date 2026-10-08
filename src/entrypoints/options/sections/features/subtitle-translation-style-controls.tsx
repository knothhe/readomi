import type { SubtitleStyle } from "@/types/config/subtitle-style"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { SUBTITLE_TRANSLATION_COLORS, SUBTITLE_TRANSLATION_FONTS } from "@/types/config/subtitle-style"
import { SettingsRow } from "../../components/settings-section"

export function SubtitleTranslationStyleControls({ style, onChange }: { style: SubtitleStyle, onChange: (patch: Partial<SubtitleStyle>) => void }) {
  const id = useId()
  const [draft, setDraft] = useState<{ source: SubtitleStyle, value: string } | null>(null)
  const [showError, setShowError] = useState(false)
  const value = draft?.source === style ? draft.value : style.translationColor.toUpperCase()
  const valid = /^#[\da-f]{6}$/i.test(value)
  const changeColor = (translationColor: string) => {
    setDraft(null)
    setShowError(false)
    onChange({ translationColor: translationColor.toLowerCase() })
  }
  const commitColor = () => {
    setShowError(!valid)
    if (valid && value.toLowerCase() !== style.translationColor)
      changeColor(value)
  }

  return (
    <>
      <SettingsRow
        label={i18n.t("subtitleStyle.translationFont")}
        htmlFor={`${id}-font`}
        control={(
          <select
            id={`${id}-font`}
            className="subtitle-translation-font-select"
            value={style.translationFont}
            onChange={event => onChange({ translationFont: event.target.value as SubtitleStyle["translationFont"] })}
          >
            {SUBTITLE_TRANSLATION_FONTS.map(font => <option key={font} value={font}>{i18n.t(`subtitleStyle.translationFonts.${font}`)}</option>)}
          </select>
        )}
      >
        <p className="subtitle-control-help">{i18n.t("subtitleStyle.translationFontDescription")}</p>
      </SettingsRow>
      <SettingsRow
        label={i18n.t("subtitleStyle.translationColor")}
        htmlFor={`${id}-color`}
        control={(
          <div className="subtitle-color-entry">
            <input type="color" aria-label={i18n.t("subtitleStyle.translationColorPicker")} value={style.translationColor} onChange={event => changeColor(event.target.value)} />
            <input
              id={`${id}-color`}
              type="text"
              aria-label={i18n.t("subtitleStyle.translationColorValue")}
              aria-invalid={showError && !valid}
              aria-describedby={showError && !valid ? `${id}-error` : undefined}
              value={value}
              maxLength={7}
              spellCheck={false}
              onChange={(event) => {
                setDraft({ source: style, value: event.target.value })
                setShowError(false)
              }}
              onBlur={commitColor}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  commitColor()
                }
                else if (event.key === "Escape") {
                  setDraft(null)
                  setShowError(false)
                }
              }}
            />
          </div>
        )}
      >
        <div className="subtitle-color-options" role="group" aria-label={i18n.t("subtitleStyle.translationColor")}>
          {(Object.entries(SUBTITLE_TRANSLATION_COLORS) as [keyof typeof SUBTITLE_TRANSLATION_COLORS, string][]).map(([name, color]) => (
            <button type="button" key={name} aria-pressed={style.translationColor.toLowerCase() === color} onClick={() => changeColor(color)}>
              <span aria-hidden="true" style={{ backgroundColor: color }} />
              {i18n.t(`subtitleStyle.translationColors.${name}`)}
            </button>
          ))}
        </div>
        <p className="subtitle-control-help">{i18n.t("subtitleStyle.translationColorDescription")}</p>
        {showError && !valid && <p id={`${id}-error`} className="subtitle-original-error" role="alert">{i18n.t("subtitleStyle.translationColorInvalid")}</p>}
      </SettingsRow>
    </>
  )
}
