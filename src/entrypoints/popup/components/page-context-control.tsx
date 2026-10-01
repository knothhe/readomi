import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { TranslationControlRow } from "./translation-control-row"

/** Shares the page-context preference with the quality section in Settings. */
export function PageContextControl() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)
  const id = useId()
  const label = i18n.t("options.quality.context.title")

  return (
    <TranslationControlRow
      label={label}
      controlId={id}
      control={(
        <Switch
          id={id}
          aria-label={label}
          checked={translateConfig.enableAIContentAware}
          onCheckedChange={enableAIContentAware => void setTranslateConfig({ enableAIContentAware })}
        />
      )}
    />
  )
}
