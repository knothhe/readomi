import type { Config } from "@/types/config/config"
import { storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "../constants/config"
import { logger } from "../logger"
import { describeConfigIssues } from "./storage"
import { withConfigWriteLock } from "./write-lock"

const CONFIG_KEY = `local:${CONFIG_STORAGE_KEY}` as const

/**
 * Initialize the config, this function should only be called once in the background script.
 * Only a missing config is initialized. Invalid stored data is logged and
 * left untouched so it can be replaced through import or an explicit reset.
 */
export async function initializeConfig() {
  await withConfigWriteLock(initializeConfigUnderLock)
}

async function initializeConfigUnderLock() {
  const storedConfig = await storage.getItem<unknown>(CONFIG_KEY)

  let config: Config
  let didConfigChange = false

  if (storedConfig == null) {
    config = DEFAULT_CONFIG
    didConfigChange = true
  }
  else {
    const parsed = configSchema.safeParse(storedConfig)
    if (!parsed.success) {
      logger.error(`Stored config is invalid, leaving it unchanged: ${describeConfigIssues(parsed.error)}`)
      return
    }
    config = parsed.data
  }

  if (import.meta.env.DEV) {
    const apiKeyResult = applyAPIKeysFromEnv(config)
    config = apiKeyResult.config
    didConfigChange = didConfigChange || apiKeyResult.changed
  }

  if (didConfigChange)
    await storage.setItem<Config>(CONFIG_KEY, config)
}

function applyAPIKeysFromEnv(config: Config): { config: Config, changed: boolean } {
  let changed = false

  const providersConfig = config.providersConfig.map((providerConfig) => {
    const apiKeyEnvName = `WXT_${providerConfig.provider.toUpperCase()}_API_KEY`
    const envApiKey = import.meta.env[apiKeyEnvName] as string | undefined
    if (!envApiKey || providerConfig.apiKey === envApiKey) {
      return providerConfig
    }

    changed = true
    return {
      ...providerConfig,
      apiKey: envApiKey,
    }
  })

  if (!changed) {
    return { config, changed: false }
  }

  return {
    config: {
      ...config,
      providersConfig,
    },
    changed: true,
  }
}
