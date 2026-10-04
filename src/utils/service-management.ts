import type { Config } from "@/types/config/config"
import type { ConnectionCheck, ProviderConfig } from "@/types/config/provider"
import { providerConfigItemSchema } from "@/types/config/provider"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import { getUniqueName } from "@/utils/name"
import { deepEqual } from "@/utils/object"

export function isProviderReady(provider: ProviderConfig | null | undefined): provider is ProviderConfig {
  return !!provider?.enabled && !!provider.apiKey?.trim() && !!provider.model.trim()
}

/** Only the untouched installation placeholder can be replaced by an initial setup. */
export function initialProviderPlaceholder(config: Config): ProviderConfig | undefined {
  if (config.providersConfig.length !== 1)
    return undefined
  const provider = config.providersConfig[0]
  return config.translate.providerId === provider.id && deepEqual(provider, DEFAULT_PROVIDER_CONFIG)
    ? provider
    : undefined
}

export interface SaveProviderAction {
  /** The exact settings that passed the connection check. */
  provider: ProviderConfig
  mode: "add" | "edit"
  makeCurrent?: boolean
}

export function saveProvider(config: Config, action: SaveProviderAction): Config {
  const provider = providerConfigItemSchema.parse(action.provider)
  if (!isProviderReady(provider) || !provider.connectionCheck?.ok)
    throw new Error("The service must pass a connection check before it can be saved")

  const existing = config.providersConfig.find(candidate => candidate.id === provider.id)
  const placeholder = initialProviderPlaceholder(config)
  if (action.mode === "edit" && !existing)
    throw new Error("The service being edited no longer exists")
  if (action.mode === "add" && existing && existing.id !== placeholder?.id)
    throw new Error("A service with this ID already exists")

  const otherProviders = config.providersConfig.filter(candidate => candidate.id !== provider.id && candidate.id !== placeholder?.id)
  const names = new Set(otherProviders.map(candidate => candidate.name))
  const next = { ...provider, name: names.has(provider.name) ? getUniqueName(provider.name, names) : provider.name }
  const providersConfig = action.mode === "edit"
    ? config.providersConfig.map(candidate => candidate.id === provider.id ? next : candidate)
    : [...otherProviders, next]
  const makeCurrent = action.mode === "add" && (action.makeCurrent || !!placeholder || !config.providersConfig.some(isProviderReady))

  return {
    ...config,
    providersConfig,
    translate: makeCurrent ? { ...config.translate, providerId: provider.id } : config.translate,
  }
}

export function selectProvider(config: Config, providerId: string): Config {
  if (!isProviderReady(config.providersConfig.find(provider => provider.id === providerId)))
    throw new Error("The selected service is unavailable or has not been configured")
  return { ...config, translate: { ...config.translate, providerId } }
}

export function removeProvider(config: Config, providerId: string): Config {
  if (providerId === config.translate.providerId)
    throw new Error("Switch to another service before removing the current service")
  return { ...config, providersConfig: config.providersConfig.filter(provider => provider.id !== providerId) }
}

/** Ignore a completed check if the service was edited or removed while it was running. */
export function saveProviderCheck(config: Config, tested: ProviderConfig, check: ConnectionCheck): Config {
  const existing = config.providersConfig.find(provider => provider.id === tested.id)
  if (!existing)
    return config
  const { connectionCheck: _existingCheck, ...existingSettings } = existing
  const { connectionCheck: _testedCheck, ...testedSettings } = tested
  if (!deepEqual(existingSettings, testedSettings))
    return config
  return {
    ...config,
    providersConfig: config.providersConfig.map(provider => provider.id === tested.id ? { ...provider, connectionCheck: check } : provider),
  }
}
