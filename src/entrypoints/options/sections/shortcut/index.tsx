import { useAtom } from "jotai"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { ShortcutKeyRecorder } from "@/components/shortcut-key-recorder"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { DEFAULT_AUTO_TRANSLATE_SHORTCUT_KEY } from "@/utils/constants/translate"
import { normalizePageTranslationShortcut } from "@/utils/page-translation-shortcut"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"

/** Keyboard shortcuts, each named after the action it runs, as the popup names that action. */
export function ShortcutSection() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const [error, setError] = useState(false)
  const togglePageId = useId()
  const modeId = useId()
  const subtitlesId = useId()
  const hoverId = useId()
  const change = (action: "page" | "modeShortcut" | "subtitlesShortcut", shortcut: string) => {
    const other = [
      action !== "page" ? translateConfig.page.shortcut : "",
      action !== "modeShortcut" ? features.modeShortcut : "",
      action !== "subtitlesShortcut" ? features.subtitlesShortcut : "",
    ].filter(s => s.trim())
    const conflict = !!shortcut.trim() && ["mac", "windows"].some(platform => other.some(s => normalizePageTranslationShortcut(s, platform as "mac" | "windows") === normalizePageTranslationShortcut(shortcut, platform as "mac" | "windows")))
    setError(conflict)
    if (conflict)
      return false
    if (action === "page")
      void setTranslateConfig({ page: { shortcut } })
    else
      void setFeatures({ [action]: shortcut })
    return true
  }

  return (
    <SettingsSection id="shortcut" title={i18n.t("options.shortcut.title")}>
      <SettingsGroup>
        <SettingsRow
          label={i18n.t("options.shortcut.togglePage")}
          htmlFor={togglePageId}
          control={(
            <ShortcutKeyRecorder
              id={togglePageId}
              className="w-28 text-center"
              shortcutKey={translateConfig.page.shortcut ?? DEFAULT_AUTO_TRANSLATE_SHORTCUT_KEY}
              onChange={shortcut => change("page", shortcut)}
            />
          )}
        />
        <SettingsRow label={i18n.t("translationShortcuts.mode")} htmlFor={modeId} control={<ShortcutKeyRecorder id={modeId} className="w-28 text-center" shortcutKey={features.modeShortcut} onChange={shortcut => change("modeShortcut", shortcut)} />} />
        <SettingsRow label={i18n.t("translationShortcuts.subtitles")} htmlFor={subtitlesId} control={<ShortcutKeyRecorder id={subtitlesId} className="w-28 text-center" shortcutKey={features.subtitlesShortcut} onChange={shortcut => change("subtitlesShortcut", shortcut)} />} />
      </SettingsGroup>
      <p className="text-xs text-muted-foreground">{i18n.t("translationShortcuts.hint")}</p>
      {error && <p role="alert" className="text-xs text-destructive">{i18n.t("translationShortcuts.conflict")}</p>}
      <SettingsGroup>
        <SettingsRow label={i18n.t("translationShortcuts.hover")} htmlFor={hoverId}>
          <select id={hoverId} className="w-full rounded-lg border border-input bg-card px-3 py-2" value={features.hoverHotkey} onChange={e => void setFeatures({ hoverHotkey: e.target.value as typeof features.hoverHotkey })}>
            {(["alt", "control", "shift", "backtick", "clickAndHold"] as const).map(key => <option key={key} value={key}>{i18n.t(`translationShortcuts.${key}`)}</option>)}
          </select>
        </SettingsRow>
      </SettingsGroup>
      <p className="text-xs text-muted-foreground">{i18n.t("translationShortcuts.hoverHint")}</p>
    </SettingsSection>
  )
}
