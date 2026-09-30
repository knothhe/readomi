import { useAtom } from "jotai"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"

export function FeaturesSection() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  return (
    <SettingsSection id="features" title={i18n.t("features.title")}>
      <SettingsGroup>
        <SettingsRow label={i18n.t("features.hover")} description={i18n.t("features.hoverDescription")} control={<Switch aria-label={i18n.t("features.hover")} checked={features.hoverTranslation} onCheckedChange={hoverTranslation => void setFeatures({ hoverTranslation })} />} />
        <SettingsRow label={i18n.t("features.video")} description={i18n.t("features.videoDescription")} control={<Switch aria-label={i18n.t("features.video")} checked={features.videoSubtitles} onCheckedChange={videoSubtitles => void setFeatures({ videoSubtitles })} />} />
        <SettingsRow
          label={i18n.t("features.mode")}
          control={(
            <select aria-label={i18n.t("features.mode")} className="rounded-lg border border-input bg-card px-3 py-2" value={features.subtitleMode} onChange={e => void setFeatures({ subtitleMode: e.target.value as typeof features.subtitleMode })}>
              <option value="bilingual">{i18n.t("options.reading.mode.bilingual")}</option>
              <option value="translationOnly">{i18n.t("options.reading.mode.translationOnly")}</option>
            </select>
          )}
        />
      </SettingsGroup>
    </SettingsSection>
  )
}
