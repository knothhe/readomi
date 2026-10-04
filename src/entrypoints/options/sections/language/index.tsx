import type { LangCodeISO6393 } from "@/definitions"
import type { Config } from "@/types/config/config"
import { useAtom, useAtomValue } from "jotai"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { IconArrowRight, IconCheck } from "@/components/icons"
import { SegmentedControl } from "@/components/segmented-control"
import { toast } from "@/components/toast"
import { TranslationLanguagePicker } from "@/components/translation-language-picker"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getLanguageDirectionAndLang } from "@/utils/content/language-direction"
import { getLanguageName } from "@/utils/language-labels"
import { getSecondaryLanguage, isPrimaryLanguagePreserved } from "@/utils/language-policy"
import { SettingsSection } from "../../components/settings-section"
import "./style.css"

const SAMPLES: Partial<Record<LangCodeISO6393, readonly [string, string]>> = {
  "cmn": ["好的设计，为日常生活留出空间。", "先读懂世界，再表达自己。"],
  "cmn-Hant": ["好的設計，為日常生活留出空間。", "先讀懂世界，再表達自己。"],
  "eng": ["Good design leaves room for everyday life.", "Understand the world before expressing yourself."],
  "jpn": ["良いデザインは、日常の暮らしに余白を残す。", "自分を表現する前に、世界を理解する。"],
  "kor": ["좋은 디자인은 일상에 여유를 남깁니다.", "자신을 표현하기 전에 세상을 이해하세요."],
  "fra": ["Un bon design laisse de la place à la vie quotidienne.", "Comprendre le monde avant de s’exprimer."],
  "deu": ["Gutes Design lässt Raum für den Alltag.", "Die Welt verstehen, bevor man sich selbst ausdrückt."],
  "spa": ["El buen diseño deja espacio para la vida cotidiana.", "Comprender el mundo antes de expresarse."],
}

type PreviewMode = "bilingual" | "translationOnly"

function PreviewCard({ source, target, sampleIndex, mode, preserved = false, primary = false }: {
  source: LangCodeISO6393
  target: LangCodeISO6393
  sampleIndex: 0 | 1
  mode: PreviewMode
  preserved?: boolean
  primary?: boolean
}) {
  const original = SAMPLES[source]?.[sampleIndex]
  const translated = preserved ? undefined : SAMPLES[target]?.[sampleIndex]
  const unavailable = !original || (!preserved && !translated)
  return (
    <article className="language-preview-paper" data-preview={primary ? "primary" : "other"} data-preserved={preserved || undefined} data-mode={mode}>
      <div className="language-preview-direction">
        <span>{getLanguageName(source)}</span>
        <IconArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{preserved ? i18n.t("options.language.keepOriginal") : getLanguageName(target)}</span>
        {preserved && <span className="language-preview-keep">{i18n.t("options.language.shownOnce")}</span>}
      </div>
      {!unavailable && original && (preserved || mode === "bilingual") && <p className="language-preview-original" data-language={source} {...getLanguageDirectionAndLang(source)}>{original}</p>}
      {!unavailable && translated && <p className="language-preview-translation" data-language={target} {...getLanguageDirectionAndLang(target)}>{translated}</p>}
      {unavailable && <p className="language-preview-unavailable">{i18n.t("options.language.sampleUnavailable")}</p>}
    </article>
  )
}

export function LanguageSection() {
  const [language, setLanguage] = useAtom(configFieldsAtomMap.language)
  const translate = useAtomValue(configFieldsAtomMap.translate)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(translate.mode)
  const primaryHelpId = useId()
  const secondaryHelpId = useId()
  const primaryName = getLanguageName(language.targetCode)
  const secondary = getSecondaryLanguage(language)
  const preserved = isPrimaryLanguagePreserved(language)
  const otherCode = language.targetCode === "eng" ? "cmn" : "eng"
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
      <section className="language-settings-preview" aria-label={i18n.t("options.preview")}>
        <div className="language-settings-preview-heading">
          <h2>{i18n.t("options.preview")}</h2>
          <SegmentedControl
            aria-label={i18n.t("options.language.previewMode")}
            size="sm"
            value={previewMode}
            options={[{ value: "bilingual", label: i18n.t("popup.bilingual") }, { value: "translationOnly", label: i18n.t("popup.translationOnly") }]}
            onChange={setPreviewMode}
          />
        </div>
        <div className="language-settings-preview-grid">
          <PreviewCard source={otherCode} target={language.targetCode} sampleIndex={0} mode={previewMode} />
          <PreviewCard source={language.targetCode} target={secondary === "original" ? language.targetCode : secondary} sampleIndex={1} mode={previewMode} preserved={preserved} primary />
        </div>
        <p className="language-settings-preview-note">{i18n.t(preserved ? previewMode === "translationOnly" ? "options.language.previewOnlyKeepNote" : "options.language.previewKeepNote" : "options.language.previewNote")}</p>
      </section>
      <p className="language-settings-foot">
        <IconCheck className="size-3.5 text-success" aria-hidden="true" />
        {i18n.t("options.language.applied")}
      </p>
    </SettingsSection>
  )
}
