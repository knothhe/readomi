import { useAtomValue } from "jotai"
import { i18n } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { featureProviderConfigAtom } from "@/utils/atoms/provider"
import { isSiteDisabled } from "@/utils/site-disable"
import { activeTabAtom } from "./atoms"
import { HoverTranslationControl } from "./components/hover-translation-control"
import { LanguageRow } from "./components/language-row"
import { PopupFooter } from "./components/popup-footer"
import { SetupPromptCard } from "./components/setup-prompt-card"
import { SiteDisableControl } from "./components/site-disable-control"
import { SiteRuleAgentEntry } from "./components/site-rule-agent-entry"
import { TranslateButton } from "./components/translate-button"
import { TranslationHelp } from "./components/translation-help"
import { VideoTranslationControl } from "./components/video-translation-control"
import { usePopupSync } from "./use-popup-sync"

/** Shared languages, then separate web-text and subtitle controls. */
export default function App() {
  usePopupSync()
  const providerConfig = useAtomValue(featureProviderConfigAtom("translate"))
  const config = useAtomValue(configAtom)
  const tab = useAtomValue(activeTabAtom)
  const disabled = isSiteDisabled(tab.url, config)
  const needsApiKey = !!providerConfig && !providerConfig.apiKey?.trim()

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-3.5">
        <LanguageRow muted={needsApiKey} />
        {!disabled && (
          <>
            {needsApiKey && <SetupPromptCard />}
            <section aria-label={i18n.t("popup.pageText")} className="flex flex-col gap-2">
              {!needsApiKey && <TranslateButton />}
              <HoverTranslationControl />
            </section>
            <VideoTranslationControl />
          </>
        )}
        <SiteDisableControl />
        {!disabled && <TranslationHelp><SiteRuleAgentEntry /></TranslationHelp>}
      </div>
      <PopupFooter />
    </div>
  )
}
