import type { Config } from "@/types/config/config"
import type { TranslationTask } from "@/types/config/translate"

type TranslationConfig = Pick<Config, "translate" | "providersConfig">

export const TRANSLATION_TASK_LABELS = {
  page: "translationModels.page",
  hover: "translationModels.hover",
  video: "translationModels.video",
  input: "translationModels.input",
} as const

/** A null assignment keeps the existing shared-service behavior. */
export function translationProviderId(config: TranslationConfig, task: TranslationTask): string {
  return config.translate.modelProviders?.[task] ?? config.translate.providerId
}

export function translationProvider(config: TranslationConfig, task: TranslationTask) {
  return config.providersConfig.find(provider => provider.id === translationProviderId(config, task))
}

export function isProviderInUse(config: TranslationConfig, providerId: string): boolean {
  return config.translate.providerId === providerId
    || Object.values(config.translate.modelProviders ?? {}).includes(providerId)
}
