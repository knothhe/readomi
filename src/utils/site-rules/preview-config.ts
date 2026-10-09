import type { Config } from "@/types/config/config"
import type { SiteRulesConfig } from "@/types/config/site-rules"
import { getLocalConfig, watchLocalConfig } from "@/utils/config/storage"
import { isExtensionContextInvalidatedError, isExtensionContextValid } from "@/utils/extension-context"
import { logger } from "@/utils/logger"

export interface HostPreviewConfig {
  siteRules: SiteRulesConfig
  sessionId: string
  generation: number
}

let preview: HostPreviewConfig | null = null
let revision = 0
const listeners = new Set<(next: HostPreviewConfig | null, previous: HostPreviewConfig | null, revision: number) => Promise<void>>()

export function getHostPreviewContext(): Pick<HostPreviewConfig, "sessionId" | "generation"> | null {
  return preview ? { sessionId: preview.sessionId, generation: preview.generation } : null
}

function overlay(config: Config | null, value = preview): Config | null {
  return config && value ? { ...config, siteRules: value.siteRules } : config
}

/** The overlay is local to this content-script frame and never writes storage. */
export async function getHostConfig(): Promise<Config | null> {
  return overlay(await getLocalConfig())
}

export async function setHostPreviewConfig(next: HostPreviewConfig | null): Promise<void> {
  const previous = preview
  preview = next
  const version = ++revision
  await Promise.all([...listeners].map(listener => listener(next, previous, version)))
}

export function watchHostConfig(callback: (next: Config | null, previous: Config | null) => void): () => void {
  let stopped = false
  const unwatch = watchLocalConfig((next, previous) => {
    if (!stopped)
      callback(overlay(next), overlay(previous))
  })
  const changed = async (next: HostPreviewConfig | null, previous: HostPreviewConfig | null, version: number) => {
    if (stopped || !isExtensionContextValid())
      return
    try {
      const stored = await getLocalConfig()
      if (!stopped && version === revision && isExtensionContextValid())
        callback(overlay(stored, next), overlay(stored, previous))
    }
    catch (error) {
      if (!isExtensionContextInvalidatedError(error))
        throw error
    }
  }
  listeners.add(changed)
  return () => {
    stopped = true
    listeners.delete(changed)
    unwatch()
  }
}

export function subscribeHostConfig(callback: (config: Config | null) => void): () => void {
  let stopped = false
  let changed = false
  const unwatch = watchHostConfig((config) => {
    changed = true
    callback(config)
  })
  void getHostConfig().then((config) => {
    if (!stopped && !changed && isExtensionContextValid())
      callback(config)
  }).catch(error => logger.warn("Failed to read host config:", error))
  return () => {
    stopped = true
    unwatch()
  }
}
