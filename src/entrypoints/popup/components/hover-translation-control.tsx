import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { openOptionsPage } from "@/utils/navigation"

/** The same global preference as Settings, with a shortcut to its trigger. */
export function HoverTranslationControl() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const id = useId()

  return (
    <div className="flex h-8 items-center justify-between gap-2 px-0.5">
      <label htmlFor={id} className="text-[13px]">{i18n.t("features.hover")}</label>
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          aria-label={i18n.t("translationShortcuts.hover")}
          title={i18n.t("features.hoverDescription")}
          onClick={() => void openOptionsPage({ section: "shortcut" })}
          className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {i18n.t(`translationShortcuts.${features.hoverHotkey}`)}
        </button>
        <Switch
          id={id}
          aria-label={i18n.t("features.hover")}
          checked={features.hoverTranslation}
          onCheckedChange={hoverTranslation => void setFeatures({ hoverTranslation })}
        />
      </div>
    </div>
  )
}
