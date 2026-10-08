import type { PageTranslationRequestOptions } from "./stream-request"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { WebPagePromptContext } from "@/types/content"
import type { LanguagePolicyConfig } from "@/utils/language-policy"
import { i18n } from "#imports"
import { toast } from "@/components/toast"
import { getProviderConfigById } from "@/utils/config/helpers"
import { getLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { getSecondaryLanguage } from "@/utils/language-policy"
import { logger } from "@/utils/logger"
import { getTranslatePrompt } from "@/utils/prompts/translate"
import { hasProviderCredentials } from "@/utils/service-management"
import { sha256Hex } from "../../hash"
import { sendMessage } from "../../message"
import { requestHoverStream } from "./stream-request"
import { prepareTranslationText } from "./text-preparation"
import { AUTOMATIC_TARGET_LANGUAGE, displayTranslationResult, TRANSLATION_PROTOCOL_VERSION } from "./translation-result"

export function normalizePromptContextValue(value: string | null | undefined): string | null | undefined {
  if (value == null) {
    return value
  }
  return value.trim() === "" ? null : value
}

function normalizeWebPagePromptContext(webPageContext?: WebPagePromptContext): WebPagePromptContext | undefined {
  if (!webPageContext) {
    return undefined
  }

  return {
    webTitle: normalizePromptContextValue(webPageContext.webTitle),
    webDescription: normalizePromptContextValue(webPageContext.webDescription),
    webContent: normalizePromptContextValue(webPageContext.webContent),
    webSummary: normalizePromptContextValue(webPageContext.webSummary),
  }
}

// Render the selected rules with fixed context tokens for domain-scoped cache
// keys. Keep the tokens populated so edits to context-bearing template lines
// still invalidate the cache, without incorporating any page's actual metadata.
const WEB_CACHE_PROMPT_CONTEXT: WebPagePromptContext = {
  webTitle: "{{webTitle}}",
  webDescription: "{{webDescription}}",
  webContent: "{{webContent}}",
  webSummary: "{{webSummary}}",
}

async function buildWebPageHashComponents(
  text: string,
  providerConfig: ProviderConfig,
  langConfig: LanguagePolicyConfig,
  customPromptsConfig: Config["translate"]["customPromptsConfig"],
  webPageContext?: WebPagePromptContext,
  isBatch: boolean = true,
): Promise<string[]> {
  const preparedText = prepareTranslationText(text)
  const normalizedWebPageContext = normalizeWebPagePromptContext(webPageContext)
  const hashComponents = [
    preparedText,
    JSON.stringify(providerConfig),
    TRANSLATION_PROTOCOL_VERSION,
    langConfig.targetCode,
    getSecondaryLanguage(langConfig),
  ]

  const { systemPrompt, prompt } = await getTranslatePrompt(AUTOMATIC_TARGET_LANGUAGE, preparedText, {
    isBatch,
    context: normalizedWebPageContext,
    languagePolicy: langConfig,
    customPromptsConfig,
  })
  // Hash the rendered rules; web cache context is fixed by the caller.
  hashComponents.push(systemPrompt, prompt)

  return hashComponents
}

export interface TranslateTextOptions extends PageTranslationRequestOptions {
  text: string
  langConfig: LanguagePolicyConfig & Partial<Pick<Config["language"], "sourceCode" | "level">>
  providerConfig: ProviderConfig
  extraHashTags?: string[]
  /** Subtitles and typed input retain page isolation; web text uses the hostname. */
  cacheScope?: "page"
  webPageContext?: WebPagePromptContext
}

/**
 * Share one prompt snapshot with the cache and background request. Callers
 * supply it with the language/provider config; older callers read it once.
 */
export async function translateTextCore(options: TranslateTextOptions): Promise<string> {
  options.signal?.throwIfAborted()
  const {
    text,
    langConfig,
    providerConfig,
    extraHashTags = [],
    webPageContext,
  } = options

  const preparedText = prepareTranslationText(text)
  if (preparedText === "") {
    return ""
  }

  const normalizedWebPageContext = normalizeWebPagePromptContext(webPageContext)
  const customPromptsConfig = options.customPromptsConfig ?? (await getLocalConfig() ?? DEFAULT_CONFIG).translate.customPromptsConfig

  const hashComponents = await buildWebPageHashComponents(
    preparedText,
    providerConfig,
    langConfig,
    customPromptsConfig,
    options.cacheScope === "page" ? normalizedWebPageContext : WEB_CACHE_PROMPT_CONTEXT,
    !options.onPartial,
  )

  // Add extra hash tags for cache differentiation
  hashComponents.push(...extraHashTags)

  const hash = await sha256Hex(...hashComponents)
  const pageUrl = typeof window === "undefined" ? undefined : window.location.href
  options.signal?.throwIfAborted()
  if (options.onPartial) {
    return requestHoverStream({ text: preparedText, langConfig, providerConfig, hash, pageUrl, cacheScope: options.cacheScope, context: normalizedWebPageContext, customPromptsConfig }, options)
  }
  const result = await sendMessage("enqueueTranslateRequest", {
    text: preparedText,
    langConfig,
    providerConfig,
    scheduleAt: Date.now(),
    hash,
    pageUrl,
    cacheScope: options.cacheScope,
    customPromptsConfig,
    webTitle: normalizedWebPageContext?.webTitle,
    webDescription: normalizedWebPageContext?.webDescription,
    webContent: normalizedWebPageContext?.webContent,
    webSummary: normalizedWebPageContext?.webSummary,
  })
  options.signal?.throwIfAborted()
  if (result.targetCode)
    options.onTargetLanguage?.(result.targetCode)
  return displayTranslationResult(result)
}

export function validateTranslationConfigAndToast(
  config: Pick<Config, "providersConfig" | "translate" | "language">,
): boolean {
  const { providersConfig, translate: translateConfig } = config
  const providerConfig = getProviderConfigById(providersConfig, translateConfig.providerId)
  if (!providerConfig) {
    return false
  }

  // check if the API key is configured
  if (!hasProviderCredentials(providerConfig)) {
    toast.error(i18n.t("translation.noApiKey"))
    logger.info("validateTranslationConfig: returning false (no API key)")
    return false
  }

  return true
}
