import { useAtom, useAtomValue } from "jotai"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { useConfigReset } from "@/hooks/use-config-reset"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { featureProviderConfigAtom } from "@/utils/atoms/provider"
import { HoverTranslationControl } from "./components/hover-translation-control"
import { LanguageRow } from "./components/language-row"
import { PopupFooter } from "./components/popup-footer"
import { SetupPromptCard } from "./components/setup-prompt-card"
import { TranslateButton } from "./components/translate-button"
import { usePopupSync } from "./use-popup-sync"

function DisplayModeControl() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)

  return (
    <SegmentedControl
      aria-label={i18n.t("popup.displayMode")}
      size="sm"
      className="[&_button]:text-[12px]"
      value={translateConfig.mode}
      options={[
        { value: "bilingual", label: i18n.t("popup.bilingual") },
        { value: "translationOnly", label: i18n.t("popup.translationOnly") },
      ]}
      onChange={mode => void setTranslateConfig({ mode })}
    />
  )
}

/**
 * Popup layout reads top to bottom as one sentence: from this language, into
 * that language, shown this way, translate. When the chosen service has no
 * key yet, a card pointing to the settings page takes the action's place.
 */
export default function App() {
  usePopupSync()
  const providerConfig = useAtomValue(featureProviderConfigAtom("translate"))
  const needsApiKey = !!providerConfig && !providerConfig.apiKey?.trim()
  const configReset = useConfigReset()

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 p-3.5">
        <LanguageRow muted={needsApiKey} />
        {needsApiKey
          ? <SetupPromptCard afterReset={configReset} />
          : (
              <>
                <DisplayModeControl />
                <TranslateButton />
              </>
            )}
        <HoverTranslationControl />
      </div>
      <PopupFooter />
    </div>
  )
}
