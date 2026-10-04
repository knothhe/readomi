import type { PromptResolver } from "./api/ai"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { LanguagePolicyConfig } from "@/utils/language-policy"
import { aiTranslate } from "./api/ai"
import { prepareTranslationText } from "./text-preparation"
import { AUTOMATIC_TARGET_LANGUAGE } from "./translation-result"

export async function executeTranslate<TContext>(
  text: string,
  langConfig: LanguagePolicyConfig,
  providerConfig: ProviderConfig,
  promptResolver: PromptResolver<TContext>,
  options?: {
    forceBackgroundFetch?: boolean
    isBatch?: boolean
    context?: TContext
    signal?: AbortSignal
    customPromptsConfig?: Config["translate"]["customPromptsConfig"]
  },
) {
  const preparedText = prepareTranslationText(text)
  if (preparedText === "") {
    return ""
  }

  const translatedText = await aiTranslate(preparedText, AUTOMATIC_TARGET_LANGUAGE, providerConfig, promptResolver, { ...options, languagePolicy: langConfig })

  return translatedText.trim()
}
