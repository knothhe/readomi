import { useAtom, useSetAtom } from "jotai"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { ShortcutKeyRecorder } from "@/components/shortcut-key-recorder"
import { toast } from "@/components/toast"
import { Button } from "@/components/ui/button"
import { configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { DEFAULT_AUTO_TRANSLATE_SHORTCUT_KEY } from "@/utils/constants/translate"
import { normalizePageTranslationShortcut } from "@/utils/page-translation-shortcut"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"
import { SettingsSelect } from "../../components/settings-select"

/** Keyboard shortcuts, each named after the action it runs, as the popup names that action. */
export function ShortcutSection() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const writeConfig = useSetAtom(writeConfigAtom)
  const [error, setError] = useState(false)
  const [resetVersion, setResetVersion] = useState(0)
  const [restoring, setRestoring] = useState(false)
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
  const restoreDefaults = async () => {
    setError(false)
    // Discard any active recording and optimistic key before restoring persisted values.
    setResetVersion(version => version + 1)
    setRestoring(true)
    try {
      await writeConfig({
        translate: {
          page: { shortcut: DEFAULT_CONFIG.translate.page.shortcut },
        },
        features: {
          modeShortcut: DEFAULT_CONFIG.features.modeShortcut,
          subtitlesShortcut: DEFAULT_CONFIG.features.subtitlesShortcut,
        },
      })
    }
    catch {
      toast.error(i18n.t("translationShortcuts.restoreFailed"))
    }
    finally {
      setRestoring(false)
    }
  }

  return (
    <SettingsSection id="shortcut" title={i18n.t("options.shortcut.title")}>
      <div className="settings-shortcuts flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <SettingsGroup>
            <SettingsRow
              className="settings-shortcut-row"
              label={i18n.t("options.shortcut.togglePage")}
              htmlFor={togglePageId}
              control={(
                <ShortcutKeyRecorder
                  key={resetVersion}
                  id={togglePageId}
                  shortcutKey={translateConfig.page.shortcut ?? DEFAULT_AUTO_TRANSLATE_SHORTCUT_KEY}
                  onChange={shortcut => change("page", shortcut)}
                />
              )}
            />
            <SettingsRow className="settings-shortcut-row" label={i18n.t("translationShortcuts.mode")} htmlFor={modeId} control={<ShortcutKeyRecorder key={resetVersion} id={modeId} shortcutKey={features.modeShortcut} onChange={shortcut => change("modeShortcut", shortcut)} />} />
            <SettingsRow className="settings-shortcut-row" label={i18n.t("translationShortcuts.subtitles")} htmlFor={subtitlesId} control={<ShortcutKeyRecorder key={resetVersion} id={subtitlesId} shortcutKey={features.subtitlesShortcut} onChange={shortcut => change("subtitlesShortcut", shortcut)} />} />
            <div className="settings-shortcut-actions flex justify-end px-[23px] py-3.5">
              <Button variant="outline" className="h-9 rounded-[7px] px-3 text-xs" disabled={restoring} onClick={() => void restoreDefaults()}>
                {i18n.t("translationShortcuts.restoreDefaults")}
              </Button>
            </div>
          </SettingsGroup>
          <p className="text-[11px] leading-[1.7] text-muted-foreground">{i18n.t("translationShortcuts.hint")}</p>
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">{i18n.t("translationShortcuts.conflict")}</p>}
        </div>
        <SettingsGroup>
          <SettingsRow
            className="settings-hover-trigger"
            label={i18n.t("translationShortcuts.hover")}
            description={i18n.t("translationShortcuts.hoverHint")}
            htmlFor={hoverId}
            control={(
              <SettingsSelect
                id={hoverId}
                className="w-[190px]"
                value={features.hoverHotkey}
                options={(["alt", "control", "shift", "backtick", "clickAndHold"] as const).map(key => ({ value: key, label: i18n.t(`translationShortcuts.${key}`) }))}
                onValueChange={value => void setFeatures({ hoverHotkey: value as typeof features.hoverHotkey })}
              />
            )}
          />
        </SettingsGroup>
      </div>
    </SettingsSection>
  )
}
