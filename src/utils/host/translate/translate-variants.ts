import type { PageTranslationRequestOptions } from "./stream-request"
import type { Config } from "@/types/config/config"
import { resolveProviderConfig } from "@/utils/constants/feature-providers"
import { getHostConfig } from "@/utils/site-rules/preview-config"
import { translationProvider } from "@/utils/translation-models"
import { prepareTranslationText } from "./text-preparation"
import { translateTextCore } from "./translate-text"
import { getOrCreateWebPageContext } from "./webpage-context"
import { getOrGenerateWebPageSummary } from "./webpage-summary"

async function getConfigOrThrow(): Promise<Config> {
  const config = await getHostConfig()
  if (!config) {
    throw new Error("No global config when translate text")
  }
  return config
}

async function getWebPagePromptContext(
  providerConfig: ReturnType<typeof resolveProviderConfig>,
  enableAIContentAware: boolean,
  includeSummary: boolean,
): Promise<{ webTitle: string, webDescription?: string, webContent: string, webSummary?: string } | undefined> {
  const webPageContext = await getOrCreateWebPageContext()
  if (!webPageContext) {
    return undefined
  }

  const webSummary = includeSummary
    ? await getOrGenerateWebPageSummary(webPageContext, providerConfig, enableAIContentAware)
    : undefined

  return {
    webTitle: webPageContext.webTitle,
    webDescription: webPageContext.webDescription,
    webContent: webPageContext.webContent,
    webSummary: webSummary ?? undefined,
  }
}

async function translateTextUsingPageConfig(
  config: Config,
  text: string,
  providerConfig: ReturnType<typeof resolveProviderConfig>,
  options: PageTranslationRequestOptions & {
    extraHashTags?: string[]
    webPageContext?: { webTitle?: string | null, webDescription?: string | null, webContent?: string | null, webSummary?: string | null }
  } = {},
): Promise<string> {
  const preparedText = prepareTranslationText(text)
  if (preparedText === "") {
    return ""
  }

  return translateTextCore({
    text: preparedText,
    langConfig: config.language,
    providerConfig,
    extraHashTags: options.extraHashTags,
    webPageContext: options.webPageContext,
    onPartial: options.onPartial,
    onTargetLanguage: options.onTargetLanguage,
    customPromptsConfig: config.translate.customPromptsConfig,
    signal: options.signal,
  })
}

/**
 * Page translation — uses the selected page or hover model.
 * Includes skip-language logic (page translation only).
 */
export async function translateTextForPage(text: string, options: PageTranslationRequestOptions & { task?: "page" | "hover" } = {}): Promise<string> {
  options.signal?.throwIfAborted()
  const config = await getConfigOrThrow()
  const providerConfig = translationProvider(config, options.task ?? "page")
  if (!providerConfig)
    throw new Error("Translation model is not configured")
  const webPageContext = await getWebPagePromptContext(providerConfig, config.translate.enableAIContentAware, true)

  return translateTextUsingPageConfig(config, text, providerConfig, {
    ...options,
    webPageContext,
  })
}

/**
 * Page title translation — uses page translation settings, but always treats the
 * current source title as the webpage title context.
 */
export async function translateTextForPageTitle(text: string): Promise<string> {
  const config = await getConfigOrThrow()
  const providerConfig = translationProvider(config, "page")
  if (!providerConfig)
    throw new Error("Translation model is not configured")
  const webPageContext = config.translate.enableAIContentAware
    ? await getWebPagePromptContext(providerConfig, true, false)
    : undefined

  return translateTextUsingPageConfig(config, text, providerConfig, {
    extraHashTags: ["pageTitleTranslation"],
    webPageContext: {
      webTitle: text,
      webDescription: webPageContext?.webDescription,
      webContent: webPageContext?.webContent,
      webSummary: webPageContext?.webSummary,
    },
  })
}

/** Typed text follows the shared language rules without borrowing page context. */
export async function translateTextForInput(text: string, config: Config, signal?: AbortSignal): Promise<string> {
  return translateTextCore({
    text,
    langConfig: config.language,
    providerConfig: resolveProviderConfig(config, "translate"),
    customPromptsConfig: config.translate.customPromptsConfig,
    extraHashTags: ["inputTranslation"],
    cacheScope: "page",
    signal,
  })
}
