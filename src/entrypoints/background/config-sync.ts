import type { BrowserEnvironment } from "@/utils/browser-environment"
import type { StoredSyncState } from "@/utils/config/sync-state"
import { browser, storage } from "#imports"
import { detectBrowserEnvironment } from "@/utils/browser-environment"
import { getLocalConfigForWrite } from "@/utils/config/storage"
import { applySyncedConfig, ConfigSyncError, decodeSyncConfig, encodeSyncConfig, mergeSyncedConfig, parseSyncedConfig, sameSyncValue, SYNC_PREFIX, toSyncedConfig } from "@/utils/config/sync-data"
import { readSyncState, SYNC_STATE_KEY } from "@/utils/config/sync-state"
import { withConfigWriteLock } from "@/utils/config/write-lock"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { onMessage } from "@/utils/message"
import { ensureInitializedConfig } from "./config"

export const CONFIG_SYNC_ALARM = "readomi:config-sync"
const CONFIG_KEY = `local:${CONFIG_STORAGE_KEY}` as const

/** One background queue owns all sync writes. Pending edits and their base survive worker termination. */
export class ConfigSyncController {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly environment: Promise<BrowserEnvironment>,
    private readonly initialize: () => Promise<unknown>,
    private readonly schedule: (retry: boolean) => void,
  ) {}

  private run<T>(work: (environment: BrowserEnvironment) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const environment = await this.environment
      if (environment.supported)
        await this.initialize()
      return work(environment)
    })
    this.queue = result.catch(() => {})
    return result
  }

  info() {
    return this.run(async (environment) => {
      const { enabled, phase, savedAt } = await readSyncState()
      return { environment, status: environment.supported ? { enabled, phase, savedAt } : { enabled: false, phase: "off" as const, savedAt: null } }
    })
  }

  inspect() {
    return this.run(async (environment) => {
      if (!environment.supported)
        throw new Error("Chrome sync is unavailable")
      const remote = await decodeSyncConfig(await browser.storage.sync.get(null))
      return { revision: remote?.revision ?? null }
    })
  }

  enable(source: "local" | "remote", expectedRevision: string | null) {
    return this.run(async (environment) => {
      if (!environment.supported)
        throw new Error("Chrome sync is unavailable")
      const values = await browser.storage.sync.get(null)
      const remote = await decodeSyncConfig(values)
      if ((remote?.revision ?? null) !== expectedRevision || (source === "remote" && !remote))
        throw new ConfigSyncError("changed")
      if (source === "remote" && remote) {
        await withConfigWriteLock(async () => {
          const fresh = await getLocalConfigForWrite()
          await storage.setItem(CONFIG_KEY, applySyncedConfig(fresh, remote.config))
        })
        await storage.setItem<StoredSyncState>(SYNC_STATE_KEY, { enabled: true, phase: "saved", savedAt: Date.now(), baseline: remote.config, revision: remote.revision })
      }
      else {
        const local = toSyncedConfig(await getLocalConfigForWrite())
        const state: StoredSyncState = { enabled: true, phase: "pending", savedAt: null, baseline: remote?.config ?? local, revision: remote?.revision }
        await storage.setItem(SYNC_STATE_KEY, state)
        await this.publish(local, state, values)
      }
    })
  }

  disable() {
    return this.run(async () => {
      const state = await readSyncState()
      await storage.setItem(SYNC_STATE_KEY, { ...state, enabled: false, phase: "off" })
    })
  }

  changed() {
    return this.run(async (environment) => {
      const state = await readSyncState()
      if (!environment.supported || !state.enabled)
        return
      try {
        if (!sameSyncValue(toSyncedConfig(await getLocalConfigForWrite()), state.baseline)) {
          await storage.setItem(SYNC_STATE_KEY, { ...state, phase: "pending" })
          this.schedule(false)
        }
      }
      catch (error) { await this.failed(state, error) }
    })
  }

  reconcile() {
    return this.run(async (environment) => {
      let state = await readSyncState()
      if (!environment.supported || !state.enabled)
        return
      try {
        const values = await browser.storage.sync.get(null)
        const remote = await decodeSyncConfig(values)
        if (remote && remote.revision !== state.revision) {
          const baseline = state.baseline ? parseSyncedConfig(state.baseline) : undefined
          const pending = await withConfigWriteLock(async () => {
            const local = await getLocalConfigForWrite()
            const next = baseline ? mergeSyncedConfig(baseline, toSyncedConfig(local), remote.config) : remote.config
            const applied = applySyncedConfig(local, next)
            if (!sameSyncValue(local, applied))
              await storage.setItem(CONFIG_KEY, applied)
            return !sameSyncValue(next, remote.config)
          })
          state = { ...state, baseline: remote.config, revision: remote.revision, phase: pending ? "pending" : "saved", savedAt: Date.now() }
          await storage.setItem(SYNC_STATE_KEY, state)
        }
        const local = toSyncedConfig(await getLocalConfigForWrite())
        if (!remote || !sameSyncValue(local, state.baseline))
          await this.publish(local, state, values)
        else if (state.phase !== "saved")
          await storage.setItem(SYNC_STATE_KEY, { ...state, phase: "saved" })
      }
      catch (error) { await this.failed(state, error) }
    })
  }

  private async publish(config: ReturnType<typeof toSyncedConfig>, state: StoredSyncState, existing: Record<string, unknown>) {
    try {
      const encoded = await encodeSyncConfig(config, existing)
      await storage.setItem(SYNC_STATE_KEY, { ...state, phase: "pending" })
      await browser.storage.sync.set(encoded.values)
      await storage.setItem<StoredSyncState>(SYNC_STATE_KEY, { enabled: true, phase: "saved", savedAt: Date.now(), baseline: config, revision: encoded.revision })
    }
    catch (error) { await this.failed(state, error) }
  }

  private async failed(state: StoredSyncState, error: unknown) {
    const quota = error instanceof ConfigSyncError && error.reason === "quota"
    await storage.setItem(SYNC_STATE_KEY, { ...state, phase: quota ? "quota" : "failed" })
    if (!quota)
      this.schedule(true)
  }
}

export function setupConfigSync() {
  let timer: ReturnType<typeof setTimeout> | undefined
  const environment = detectBrowserEnvironment()
  const controller = new ConfigSyncController(environment, ensureInitializedConfig, (retry) => {
    // Alarms survive suspended MV3 workers. The timer provides the short debounce.
    void browser.alarms.create(CONFIG_SYNC_ALARM, { delayInMinutes: 1 }).catch(() => {})
    if (!retry) {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void controller.reconcile().catch(() => {})
      }, 2000)
    }
  })
  const optionsSender = (sender: { url?: string } | undefined) => {
    if (sender?.url?.split(/[?#]/)[0] !== browser.runtime.getURL("/options.html"))
      throw new Error("Configuration sync is only available to the settings page")
  }
  onMessage("getConfigSyncInfo", ({ sender }) => {
    optionsSender(sender)
    return controller.info()
  })
  onMessage("inspectConfigSync", ({ sender }) => {
    optionsSender(sender)
    return controller.inspect()
  })
  onMessage("setConfigSyncEnabled", async ({ data, sender }) => {
    optionsSender(sender)
    if (data.enabled) {
      if (!["local", "remote"].includes(data.source) || !(data.revision === null || typeof data.revision === "string"))
        throw new Error("Invalid configuration sync choice")
      await controller.enable(data.source, data.revision)
    }
    else {
      clearTimeout(timer)
      await controller.disable()
      await browser.alarms.clear(CONFIG_SYNC_ALARM)
    }
    return controller.info()
  })
  onMessage("retryConfigSync", async ({ sender }) => {
    optionsSender(sender)
    await controller.reconcile()
    return controller.info()
  })
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[CONFIG_STORAGE_KEY])
      void controller.changed().catch(() => {})
    if (area === "sync" && Object.keys(changes).some(key => key.startsWith(SYNC_PREFIX)))
      void controller.reconcile().catch(() => {})
  })
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CONFIG_SYNC_ALARM)
      void controller.reconcile().catch(() => {})
  })
  // Limit cloud settings to trusted extension pages, even though they contain no credentials.
  void environment.then(async ({ supported }) => {
    if (supported) {
      await browser.storage.sync.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
      await controller.reconcile()
    }
  }).catch(() => {})
}
