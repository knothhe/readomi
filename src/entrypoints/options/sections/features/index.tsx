import { useAtom } from "jotai"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"
import { SubtitleStyleEditor } from "./subtitle-style-editor"

export function FeaturesSection() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  return (
    <SettingsSection id="features" title={i18n.t("features.title")}>
      <SettingsGroup>
        <SettingsRow label={i18n.t("features.video")} description={i18n.t("features.videoDescription")} control={<Switch aria-label={i18n.t("features.video")} checked={features.videoSubtitles} onCheckedChange={videoSubtitles => void setFeatures({ videoSubtitles })} />} />
        <SettingsRow
          label={i18n.t("features.mode")}
          control={(
            <SegmentedControl
              aria-label={i18n.t("features.mode")}
              size="sm"
              value={features.subtitleMode}
              options={[
                { value: "bilingual", label: i18n.t("options.reading.mode.bilingual") },
                { value: "translationOnly", label: i18n.t("options.reading.mode.translationOnly") },
              ]}
              onChange={subtitleMode => void setFeatures({ subtitleMode })}
            />
          )}
        />
      </SettingsGroup>
      <SubtitleStyleEditor />
    </SettingsSection>
  )
}
