import { TextEncoder as NativeTextEncoder } from "node:util"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { browser, storage } from "#imports"
import { decodeSyncConfig, encodeSyncConfig, SYNC_MANIFEST_KEY, toSyncedConfig } from "@/utils/config/sync-data"
import { readSyncState, SYNC_STATE_KEY } from "@/utils/config/sync-state"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { ConfigSyncController } from "../config-sync"

afterEach(() => vi.unstubAllGlobals())

const schedule = vi.fn()
const controller = (supported = true) => new ConfigSyncController(Promise.resolve({ name: supported ? "Google Chrome" : "Firefox", supported }), async () => {}, schedule)
const config = () => storage.getItem<typeof DEFAULT_CONFIG>("local:config")
async function remote(hoverTranslation: boolean) {
  const next = toSyncedConfig(DEFAULT_CONFIG)
  next.features.hoverTranslation = hoverTranslation
  const encoded = await encodeSyncConfig(next, await browser.storage.sync.get(null))
  await browser.storage.sync.set(encoded.values)
  return encoded
}

beforeEach(async () => {
  vi.stubGlobal("TextEncoder", NativeTextEncoder)
  fakeBrowser.reset()
  vi.restoreAllMocks()
  schedule.mockClear()
  await storage.setItem("local:config", DEFAULT_CONFIG)
})

it("leaves cloud and local data untouched until sync is enabled", async () => {
  const engine = controller()
  const get = vi.spyOn(browser.storage.sync, "get")
  const set = vi.spyOn(browser.storage.sync, "set")
  await engine.reconcile()
  await engine.changed()
  expect(get).not.toHaveBeenCalled()
  expect(set).not.toHaveBeenCalled()
})
it("publishes no credentials and does not echo its own changes", async () => {
  await storage.setItem("local:config", { ...DEFAULT_CONFIG, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "private" })) })
  const engine = controller()
  await engine.enable("local", null)
  expect(JSON.stringify(await browser.storage.sync.get(null))).not.toContain("private")
  const set = vi.spyOn(browser.storage.sync, "set")
  await engine.reconcile()
  await engine.changed()
  expect(set).not.toHaveBeenCalled()
  expect(schedule).not.toHaveBeenCalled()
})
it("requires a fresh explicit choice when the existing snapshot changes", async () => {
  const first = await remote(true)
  const engine = controller()
  expect(await engine.inspect()).toEqual({ revision: first.revision })
  await remote(false)
  await expect(engine.enable("remote", first.revision)).rejects.toThrow("changed")
  expect((await readSyncState()).enabled).toBe(false)
  expect((await config())?.features.hoverTranslation).toBe(false)
})
it("accepts a remote snapshot while preserving local credentials", async () => {
  await storage.setItem("local:config", { ...DEFAULT_CONFIG, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "private" })) })
  const snapshot = await remote(true)
  const engine = controller()
  await engine.enable("remote", snapshot.revision)
  expect((await config())?.features.hoverTranslation).toBe(true)
  expect((await config())?.providersConfig[0].apiKey).toBe("private")
})
it("keeps a newly filled local key through cloud notifications, preference updates and worker restart", async () => {
  const initial = toSyncedConfig(DEFAULT_CONFIG)
  initial.providersConfig[0].model = "synced-model"
  const snapshot = await encodeSyncConfig(initial, {})
  await browser.storage.sync.set(snapshot.values)
  const engine = controller()
  await engine.enable("remote", snapshot.revision)
  const local = (await config())!
  local.providersConfig[0].apiKey = "filled-local-key"
  await storage.setItem("local:config", local)
  const publish = vi.spyOn(browser.storage.sync, "set")
  await engine.changed()
  await engine.reconcile()
  expect(publish).not.toHaveBeenCalled()
  expect(schedule).not.toHaveBeenCalled()
  const updated = structuredClone(initial)
  updated.features.hoverTranslation = true
  await browser.storage.sync.set((await encodeSyncConfig(updated, await browser.storage.sync.get(null))).values)
  await controller().reconcile()
  expect((await config())?.providersConfig[0].apiKey).toBe("filled-local-key")
  expect((await config())?.features.hoverTranslation).toBe(true)
  expect(JSON.stringify(await browser.storage.sync.get(null))).not.toContain("filled-local-key")
})
it("rebases unsaved local changes onto arriving remote changes", async () => {
  const engine = controller()
  await engine.enable("local", null)
  await storage.setItem("local:config", { ...DEFAULT_CONFIG, appearance: { ...DEFAULT_CONFIG.appearance, mode: "dark" } })
  await engine.changed()
  expect((await readSyncState()).phase).toBe("pending")
  await remote(true)
  await engine.reconcile()
  expect(await config()).toMatchObject({ appearance: { mode: "dark" }, features: { hoverTranslation: true } })
  expect((await decodeSyncConfig(await browser.storage.sync.get(null)))?.config.appearance.mode).toBe("dark")
})
it("recovers pending writes and transient failures after a worker restart", async () => {
  const engine = controller()
  await engine.enable("local", null)
  await storage.setItem("local:config", { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } })
  const write = vi.spyOn(browser.storage.sync, "set").mockRejectedValueOnce(new Error("temporary storage error"))
  await engine.reconcile()
  expect((await readSyncState()).phase).toBe("failed")
  expect(schedule).toHaveBeenCalledWith(true)
  expect((await config())?.features.hoverTranslation).toBe(true)
  write.mockRestore()
  await controller().reconcile()
  expect((await readSyncState()).phase).toBe("saved")
  expect((await decodeSyncConfig(await browser.storage.sync.get(null)))?.config.features.hoverTranslation).toBe(true)
})
it("keeps the last cloud snapshot on quota failure and retries when content is reduced", async () => {
  const engine = controller()
  await engine.enable("local", null)
  const before = await browser.storage.sync.get(null)
  await storage.setItem("local:config", { ...DEFAULT_CONFIG, siteRules: { ...DEFAULT_CONFIG.siteRules, userRules: [{ id: "huge", matches: "example.com", description: "字".repeat(40000) }] } })
  await engine.reconcile()
  expect((await readSyncState()).phase).toBe("quota")
  expect(await browser.storage.sync.get(null)).toEqual(before)
  await storage.setItem("local:config", DEFAULT_CONFIG)
  await engine.reconcile()
  expect((await readSyncState()).phase).toBe("saved")
})
it("never applies a partially delivered remote snapshot", async () => {
  const engine = controller()
  await engine.enable("local", null)
  const old = await browser.storage.sync.get(null)
  const updated = await remote(true)
  await browser.storage.sync.set({ ...old, [SYNC_MANIFEST_KEY]: updated.values[SYNC_MANIFEST_KEY] })
  await engine.reconcile()
  expect((await config())?.features.hoverTranslation).toBe(false)
  await browser.storage.sync.set(updated.values)
  await engine.reconcile()
  expect((await config())?.features.hoverTranslation).toBe(true)
})
it("stops receiving and publishing when disabled, without deleting either copy", async () => {
  const engine = controller()
  await engine.enable("local", null)
  await engine.disable()
  await remote(true)
  await engine.reconcile()
  expect((await config())?.features.hoverTranslation).toBe(false)
  expect(await browser.storage.sync.get(null)).not.toEqual({})
})
it("never accesses sync storage in a non-Chrome browser, even with an enabled local state", async () => {
  await storage.setItem(SYNC_STATE_KEY, { enabled: true, phase: "saved", savedAt: 1 })
  const engine = controller(false)
  const get = vi.spyOn(browser.storage.sync, "get")
  await engine.reconcile()
  await engine.changed()
  await expect(engine.enable("local", null)).rejects.toThrow("unavailable")
  expect((await engine.info()).status.enabled).toBe(false)
  expect(get).not.toHaveBeenCalled()
})

it("moves preferences between two isolated devices without replacing their different credentials", async () => {
  const deviceOne = { ...DEFAULT_CONFIG, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "device-one-key" })) }
  await storage.setItem("local:config", deviceOne)
  const first = controller()
  await first.enable("local", null)
  const firstState = await readSyncState()
  const firstCloud = await browser.storage.sync.get(null)

  fakeBrowser.reset()
  const deviceTwo = { ...DEFAULT_CONFIG, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "device-two-key" })) }
  await storage.setItem("local:config", deviceTwo)
  await browser.storage.sync.set(firstCloud)
  const second = controller()
  await second.enable("remote", (await second.inspect()).revision!)
  expect((await config())?.providersConfig[0].apiKey).toBe("device-two-key")
  const edited = { ...(await config())!, features: { ...DEFAULT_CONFIG.features, hoverTranslation: true } }
  await storage.setItem("local:config", edited)
  await second.reconcile()
  const secondCloud = await browser.storage.sync.get(null)

  fakeBrowser.reset()
  await storage.setItem("local:config", deviceOne)
  await storage.setItem(SYNC_STATE_KEY, firstState)
  await browser.storage.sync.set(secondCloud)
  await first.reconcile()
  expect((await config())?.features.hoverTranslation).toBe(true)
  expect((await config())?.providersConfig[0].apiKey).toBe("device-one-key")
})
