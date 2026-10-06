import type { LangCodeISO6393 } from "@/definitions"
import type { Config } from "@/types/config/config"
import { useAtom } from "jotai"
import { i18n } from "#imports"
import { IconArrowRight } from "@/components/icons"
import { toast } from "@/components/toast"
import { TranslationLanguagePicker } from "@/components/translation-language-picker"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getLanguageName } from "@/utils/language-labels"
import { getSecondaryLanguage, isPrimaryLanguagePreserved } from "@/utils/language-policy"
import { cn } from "@/utils/styles/utils"

export function LanguageRow({ muted = false }: { muted?: boolean }) {
  const [language, setLanguage] = useAtom(configFieldsAtomMap.language)
  const primaryName = getLanguageName(language.targetCode)
  const secondary = getSecondaryLanguage(language)
  const preserved = isPrimaryLanguagePreserved(language)
  const save = (patch: Partial<Config["language"]>) => {
    void setLanguage(patch).catch(() => toast.error(i18n.t("options.language.saveFailed")))
  }

  return (
    <section aria-label={i18n.t("options.language.title")} className={cn("flex flex-col", muted && "opacity-60")}>
      <div className="flex items-center justify-between gap-2 px-0.5 pb-2">
        <span className="text-xs font-medium">{i18n.t("options.language.title")}</span>
        <span className="text-[10px] text-muted-foreground">{i18n.t("options.language.auto")}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_16px_113px] items-center gap-2 px-0.5 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{i18n.t("options.language.other")}</span>
        <IconArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <TranslationLanguagePicker compact value={language.targetCode} label={i18n.t("options.language.primary")} onChange={value => value !== language.targetCode && save({ targetCode: value as LangCodeISO6393 })} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_16px_113px] items-center gap-2 px-0.5 py-1.5">
        <span className="truncate text-xs text-muted-foreground" title={primaryName}>{primaryName}</span>
        <IconArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <TranslationLanguagePicker compact value={secondary} primaryCode={language.targetCode} label={i18n.t("options.language.secondary")} onChange={value => value !== secondary && save({ secondaryCode: value })} />
      </div>
      {preserved && <p className="mt-1.5 px-0.5 text-[10px] leading-[1.5] text-muted-foreground">{i18n.t("options.language.popupKeepDescription", [primaryName])}</p>}
    </section>
  )
}
