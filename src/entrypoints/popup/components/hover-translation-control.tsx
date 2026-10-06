import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { openOptionsPage } from "@/utils/navigation"
import { TranslationControlRow } from "./translation-control-row"

/** The same global preference as Settings, with a shortcut to its trigger. */
export function HoverTranslationControl() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const id = useId()

  return (
    <TranslationControlRow
      label={i18n.t("features.hover")}
      controlId={id}
      hint={(
        <button
          type="button"
          aria-label={i18n.t("translationShortcuts.hover")}
          title={i18n.t("features.hoverDescription")}
          onClick={() => void openOptionsPage({ section: "shortcut" })}
          className="max-w-full truncate rounded text-left text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
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
          onCheckedChange={hoverTranslation => void setFeatures({ hoverTranslation })}
        />
      )}
    />
  )
}
