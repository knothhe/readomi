import type { LangCodeISO6393 } from "@/definitions"
import type { Config } from "@/types/config/config"
import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { toast } from "@/components/toast"
import { TranslationLanguagePicker } from "@/components/translation-language-picker"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getLanguageName } from "@/utils/language-labels"
import { getSecondaryLanguage, isPrimaryLanguagePreserved } from "@/utils/language-policy"
import { SettingsSection } from "../../components/settings-section"
import "./style.css"

export function LanguageSection() {
  const [language, setLanguage] = useAtom(configFieldsAtomMap.language)
  const primaryHelpId = useId()
  const secondaryHelpId = useId()
  const primaryName = getLanguageName(language.targetCode)
  const secondary = getSecondaryLanguage(language)
  const preserved = isPrimaryLanguagePreserved(language)
  const save = (patch: Partial<Config["language"]>) => {
    void setLanguage(patch).catch(() => toast.error(i18n.t("options.language.saveFailed")))
  }
  const secondaryHelp = secondary === "original"
    ? i18n.t("options.language.keepPrimary", [primaryName])
    : preserved
      ? i18n.t("options.language.sameLanguages")
      : i18n.t("options.language.toSecondary", [primaryName, getLanguageName(secondary)])

  return (
    <SettingsSection id="language" title={i18n.t("options.language.title")}>
      <p className="language-settings-intro">{i18n.t("options.language.description")}</p>
      <div className="language-settings-rules">
        <h2 className="settings-group-caption">{i18n.t("options.language.rules")}</h2>
        <div className="language-settings-rule">
          <div className="language-settings-rule-heading">
            <h3>{i18n.t("options.language.primary")}</h3>
            <TranslationLanguagePicker className="language-settings-picker" value={language.targetCode} label={i18n.t("options.language.primary")} descriptionId={primaryHelpId} onChange={value => value !== language.targetCode && save({ targetCode: value as LangCodeISO6393 })} />
          </div>
          <p id={primaryHelpId} className="language-settings-help">{i18n.t("options.language.toPrimary", [primaryName])}</p>
        </div>
        <div className="language-settings-rule">
          <div className="language-settings-rule-heading">
            <h3>{i18n.t("options.language.secondary")}</h3>
            <TranslationLanguagePicker className="language-settings-picker" value={secondary} primaryCode={language.targetCode} label={i18n.t("options.language.secondary")} descriptionId={secondaryHelpId} onChange={value => value !== secondary && save({ secondaryCode: value })} />
          </div>
          <p id={secondaryHelpId} className="language-settings-help">
            {secondaryHelp}
            {preserved && <span className="block pt-0.5">{i18n.t("options.language.keepDescription")}</span>}
          </p>
        </div>
        <div className="language-settings-auto">
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></svg>
          <div>
            <h3>{i18n.t("options.language.automaticSource")}</h3>
            <p>{i18n.t("options.language.autoDescription")}</p>
            <p className="language-settings-scope">{i18n.t("options.language.scope")}</p>
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
