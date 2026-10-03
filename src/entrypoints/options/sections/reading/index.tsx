import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { TRANSLATION_MODES } from "@/types/config/translate"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { cn } from "@/utils/styles/utils"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"
import { EnglishPreview, TranslationPreview } from "./previews"
import { StyleSetting } from "./style-setting"

const MODE_LABEL_KEY = {
  bilingual: "options.reading.mode.bilingual",
  translationOnly: "options.reading.mode.translationOnly",
} as const

/** The controls and their live page preview share the same translation settings. */
export function ReadingSection() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)
  const [readingConfig, setReadingConfig] = useAtom(configFieldsAtomMap.reading)
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const emphasisId = useId()

  return (
    <SettingsSection id="reading" title={i18n.t("options.reading.title")}>
      <div className="options-two-column">
        <div className="options-controls">
          <SettingsGroup caption={i18n.t("options.reading.whileTranslating")}>
            <div>
              <div role="group" aria-label={i18n.t("options.reading.mode.title")} className="grid grid-cols-2 gap-3 px-5 pt-5 pb-2">
                {TRANSLATION_MODES.map(mode => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={translateConfig.mode === mode}
                    onClick={() => void setTranslateConfig({ mode })}
                    className={cn(
                      "relative flex min-w-0 flex-col gap-3 rounded-[10px] border p-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      translateConfig.mode === mode ? "border-primary bg-accent/40" : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    <span aria-hidden="true" className="flex h-9 w-4/5 flex-col gap-1.5">
                      <span className="h-[3px] w-full rounded-full bg-muted-foreground/55" />
                      <span className="h-[3px] w-3/4 rounded-full bg-muted-foreground/30" />
                      <span className={cn("h-[3px] rounded-full", mode === "bilingual" ? "ml-2 w-[90%] bg-brand/65" : "w-3/5 bg-muted-foreground/55")} />
                    </span>
                    <span className="pr-4 text-xs font-medium">{i18n.t(MODE_LABEL_KEY[mode])}</span>
                    <span aria-hidden="true" className={cn("absolute right-3 bottom-4 flex size-3.5 items-center justify-center rounded-full border text-[9px]", translateConfig.mode === mode ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {translateConfig.mode === mode && "✓"}
                    </span>
                  </button>
                ))}
              </div>
              {/* The translation style applies to bilingual display only. */}
              {translateConfig.mode === "bilingual" && <StyleSetting />}
            </div>
            <SettingsRow label={i18n.t("features.hover")} description={i18n.t("features.hoverDescription")} control={<Switch aria-label={i18n.t("features.hover")} checked={features.hoverTranslation} onCheckedChange={hoverTranslation => void setFeatures({ hoverTranslation })} />} />
            <SettingsRow
              label={i18n.t("features.hoverStream")}
              description={i18n.t("features.hoverStreamDescription")}
              control={(
                <Switch
                  aria-label={i18n.t("features.hoverStream")}
                  checked={features.hoverStream}
                  disabled={!features.hoverTranslation}
                  onCheckedChange={hoverStream => void setFeatures({ hoverStream })}
                />
              )}
            />
          </SettingsGroup>
          <SettingsGroup caption={i18n.t("options.reading.allPages")}>
            <EnglishPreview />
            <SettingsRow
              label={i18n.t("options.reading.wordPrefixEmphasis.title")}
              description={i18n.t("options.reading.wordPrefixEmphasis.description")}
              htmlFor={emphasisId}
              control={(
                <Switch
                  id={emphasisId}
                  checked={readingConfig.wordPrefixEmphasis}
                  onCheckedChange={wordPrefixEmphasis => void setReadingConfig({ wordPrefixEmphasis })}
                />
              )}
            />
          </SettingsGroup>
        </div>
        <aside className="options-preview-column">
          <h3 className="options-preview-title">{i18n.t("options.preview")}</h3>
          <TranslationPreview />
        </aside>
      </div>
    </SettingsSection>
  )
}
