import type { MouseEvent } from "react"
import { useAtom } from "jotai"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { Switch } from "@/components/ui/switch"
import { TRANSLATION_MODES } from "@/types/config/translate"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"
import { CSSEditor } from "./css-editor"
import { EnglishPreview, TranslationPreview } from "./previews"
import { StyleSetting } from "./style-setting"
import "./style.css"

const MODE_LABEL_KEY = {
  bilingual: "options.reading.mode.bilingual",
  translationOnly: "options.reading.mode.translationOnly",
} as const

/** The controls and their live page preview share the same translation settings. */
export function ReadingSection({ onOpenSiteRules }: { onOpenSiteRules?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)
  const [readingConfig, setReadingConfig] = useAtom(configFieldsAtomMap.reading)
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const emphasisId = useId()
  const [customEditorOpen, setCustomEditorOpen] = useState(translateConfig.translationNodeStyle.isCustom)

  return (
    <SettingsSection id="reading" title={i18n.t("options.reading.title")}>
      <div className="options-two-column">
        <div className="options-controls">
          <SettingsGroup caption={i18n.t("options.reading.whileTranslating")}>
            <SettingsRow
              className="settings-reading-mode"
              label={i18n.t("options.reading.mode.title")}
              control={(
                <SegmentedControl
                  aria-label={i18n.t("options.reading.mode.title")}
                  size="sm"
                  value={translateConfig.mode}
                  options={TRANSLATION_MODES.map(value => ({ value, label: i18n.t(MODE_LABEL_KEY[value]) }))}
                  onChange={mode => void setTranslateConfig({ mode })}
                />
              )}
            />
            {/* Translation styles apply to bilingual display only. */}
            {translateConfig.mode === "bilingual" && <StyleSetting />}
            <SettingsRow label={i18n.t("features.hover")} description={i18n.t("features.hoverDescription")} control={<Switch aria-label={i18n.t("features.hover")} checked={features.hoverTranslation} onCheckedChange={hoverTranslation => void setFeatures({ hoverTranslation })} />} />
            {features.hoverTranslation && (
              <SettingsRow
                label={i18n.t("features.hoverStream")}
                description={i18n.t("features.hoverStreamDescription")}
                control={(
                  <Switch
                    aria-label={i18n.t("features.hoverStream")}
                    checked={features.hoverStream}
                    onCheckedChange={hoverStream => void setFeatures({ hoverStream })}
                  />
                )}
              />
            )}
            <SettingsRow
              label={i18n.t("inputTranslation.title")}
              description={(
                <>
                  {i18n.t("inputTranslation.description")}
                  <br />
                  {i18n.t("inputTranslation.languages")}
                </>
              )}
              control={<Switch aria-label={i18n.t("inputTranslation.title")} checked={features.inputTranslation} onCheckedChange={inputTranslation => void setFeatures({ inputTranslation })} />}
            />
          </SettingsGroup>
          <details className="settings-reading-more">
            <summary>{i18n.t("options.reading.moreOptions")}</summary>
            <SettingsGroup>
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
              {translateConfig.mode === "bilingual" && (
                <details className="settings-reading-custom" open={customEditorOpen} onToggle={event => setCustomEditorOpen(event.currentTarget.open)}>
                  <summary>{i18n.t("options.reading.style.custom")}</summary>
                  {customEditorOpen && <CSSEditor onCancel={() => setCustomEditorOpen(false)} />}
                </details>
              )}
            </SettingsGroup>
          </details>
          <SettingsGroup>
            <a
              href="#reading/site-rules"
              className="settings-row settings-nav-row"
              aria-label={i18n.t("siteRules.title")}
              onClick={onOpenSiteRules}
            >
              <div>
                <span className="text-[13px] font-medium">{i18n.t("siteRules.title")}</span>
                <p className="text-xs text-muted-foreground">{i18n.t("siteRules.description")}</p>
              </div>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </a>
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
