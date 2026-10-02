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
            <div className="w-44">
              <ShortcutKeyRecorder
                id={togglePageId}
                className="text-center"
                shortcutKey={translateConfig.page.shortcut ?? DEFAULT_AUTO_TRANSLATE_SHORTCUT_KEY}
                onChange={shortcut => change("page", shortcut)}
              />
            </div>
          )}
        />
        <SettingsRow label={i18n.t("translationShortcuts.mode")} htmlFor={modeId} control={<div className="w-44"><ShortcutKeyRecorder id={modeId} className="text-center" shortcutKey={features.modeShortcut} onChange={shortcut => change("modeShortcut", shortcut)} /></div>} />
        <SettingsRow label={i18n.t("translationShortcuts.subtitles")} htmlFor={subtitlesId} control={<div className="w-44"><ShortcutKeyRecorder id={subtitlesId} className="text-center" shortcutKey={features.subtitlesShortcut} onChange={shortcut => change("subtitlesShortcut", shortcut)} /></div>} />
      </SettingsGroup>
      <p className="text-xs text-muted-foreground">{i18n.t("translationShortcuts.hint")}</p>
      {error && <p role="alert" className="text-xs text-destructive">{i18n.t("translationShortcuts.conflict")}</p>}
      <SettingsGroup>
        <SettingsRow
          label={i18n.t("translationShortcuts.hover")}
          htmlFor={hoverId}
          control={(
            <select id={hoverId} className="h-8 w-44 min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-center text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" value={features.hoverHotkey} onChange={e => void setFeatures({ hoverHotkey: e.target.value as typeof features.hoverHotkey })}>
              {(["alt", "control", "shift", "backtick", "clickAndHold"] as const).map(key => <option key={key} value={key}>{i18n.t(`translationShortcuts.${key}`)}</option>)}
            </select>
          )}
        />
      </SettingsGroup>
      <p className="text-xs text-muted-foreground">{i18n.t("translationShortcuts.hoverHint")}</p>
    </SettingsSection>
  )
}
