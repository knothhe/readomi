import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { openOptionsPage } from "@/utils/navigation"
import { TranslationControlRow } from "./translation-control-row"

/** The same global preference as Settings, with a shortcut to its trigger. */
export function HoverTranslationControl({ disabled = false }: { disabled?: boolean }) {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const id = useId()

  return (
    <TranslationControlRow
      label={i18n.t("features.hover")}
      controlId={id}
      disabled={disabled}
      hint={(
        <button
          type="button"
          disabled={disabled}
          aria-label={i18n.t("translationShortcuts.hover")}
          title={i18n.t("features.hoverDescription")}
          onClick={() => void openOptionsPage({ section: "shortcut" })}
          className="popup-shortcut max-w-full truncate rounded text-left text-[11px] leading-4 text-muted-foreground transition-colors enabled:hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60"
        >
          {i18n.t(`translationShortcuts.${features.hoverHotkey}`)}
        </button>
      )}
      control={(
        <Switch
          className="popup-switch"
          id={id}
          aria-label={i18n.t("features.hover")}
          checked={features.hoverTranslation}
          disabled={disabled}
          onCheckedChange={hoverTranslation => void setFeatures({ hoverTranslation })}
        />
      )}
    />
  )
}
