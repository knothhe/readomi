import { useAtom, useAtomValue } from "jotai"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { featureProviderConfigAtom } from "@/utils/atoms/provider"
import { HoverTranslationControl } from "./components/hover-translation-control"
import { LanguageRow } from "./components/language-row"
import { PageContextControl } from "./components/page-context-control"
import { PopupFooter } from "./components/popup-footer"
import { SetupPromptCard } from "./components/setup-prompt-card"
import { TranslateButton } from "./components/translate-button"
import { VideoTranslationControl } from "./components/video-translation-control"
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
 * Language and display mode come first, then matching rows for page, hover and
 * subtitle translation and the page-context preference. A setup card replaces
 * the page action until a service is ready.
 */
export default function App() {
  usePopupSync()
  const providerConfig = useAtomValue(featureProviderConfigAtom("translate"))
  const needsApiKey = !!providerConfig && !providerConfig.apiKey?.trim()

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 p-3.5">
        <LanguageRow muted={needsApiKey} />
        {needsApiKey
          ? <SetupPromptCard />
          : <DisplayModeControl />}
        <div className="flex flex-col">
          {!needsApiKey && <TranslateButton />}
          <HoverTranslationControl />
          <VideoTranslationControl />
          <PageContextControl />
        </div>
      </div>
      <PopupFooter />
    </div>
  )
}
