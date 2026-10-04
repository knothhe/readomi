import type { LangCodeISO6393 } from "@/definitions"
import type { SecondaryLanguage } from "@/utils/language-policy"
import { i18n } from "#imports"
import { langCodeISO6393Schema } from "@/definitions"
import { getLanguageLabel, getLanguageName } from "@/utils/language-labels"
import { cn } from "@/utils/styles/utils"
import { IconChevronDown } from "./icons"
import { LanguagePicker } from "./language-picker"

/** The primary option stays selectable in the second menu; choosing it means preserving that language. */
export function TranslationLanguagePicker({ value, onChange, primaryCode, label, descriptionId, className, compact = false }: {
  value: SecondaryLanguage
  onChange: (value: SecondaryLanguage) => void
  primaryCode?: LangCodeISO6393
  label: string
  descriptionId?: string
  className?: string
  compact?: boolean
}) {
  const languageItems = langCodeISO6393Schema.options.map(code => ({
    value: code as SecondaryLanguage,
    label: getLanguageName(code),
    keywords: getLanguageLabel(code),
    badge: primaryCode === code ? <span className="ml-auto text-[10px] text-muted-foreground">{i18n.t("options.language.primary")}</span> : undefined,
  }))
  const items = primaryCode
    ? [{ value: "original" as const, label: i18n.t("options.language.keepOriginal"), separatorAfter: true }, ...languageItems]
    : languageItems

  return (
    <div className={cn("relative min-w-0", className)}>
      <LanguagePicker
        items={items}
        value={value}
        onChange={onChange}
        searchPlaceholder={i18n.t("languageCombobox.searchLanguages")}
        emptyText={i18n.t("languageCombobox.noLanguagesFound")}
        panelClassName="top-full right-0 mt-1.5 w-[244px] max-w-[calc(100vw-28px)]"
        renderTrigger={props => (
          <button
            type="button"
            aria-label={label}
            aria-describedby={descriptionId}
            data-value={value}
            className={cn("flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-card text-left outline-none transition-colors hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50", compact ? "h-8 px-2 text-[13px] font-semibold" : "h-9 px-2.5 text-xs")}
            {...props}
          >
            <span className="truncate">{value === "original" ? i18n.t("options.language.keepOriginal") : getLanguageName(value)}</span>
            <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        )}
      />
    </div>
  )
}
