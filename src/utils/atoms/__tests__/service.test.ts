import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import { createStore } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { configAtom, writeConfigAtom } from "../config"
import { moveProviderAtom, removeProviderAtom, saveProviderAtom, saveProviderCheckAtom, selectProviderAtom } from "../service"

const key = `local:${CONFIG_STORAGE_KEY}` as const
const active: ProviderConfig = { ...DEFAULT_CONFIG.providersConfig[0], apiKey: "active-key" }
const second: ProviderConfig = { id: "second", name: "DeepSeek", enabled: true, provider: "deepseek", model: "deepseek-chat", apiKey: "second-key", connectionCheck: { ok: true, checkedAt: 1 } }
const configured: Config = { ...DEFAULT_CONFIG, providersConfig: [active, second] }

async function setup(config = configured) {
  const store = createStore()
  store.set(configAtom, config)
  await storage.setItem(key, config)
  return store
}

afterEach(async () => {
  vi.restoreAllMocks()
  await storage.removeItem(key)
})

describe("service management writes", () => {
  it("moves a service against fresh storage while retaining edits, hidden entries, additions and selection", async () => {
    const store = await setup()
    const hidden = { ...second, id: "hidden", name: "Hidden", apiKey: undefined }
    const added = { ...second, id: "added", name: "Added" }
    const edited = { ...second, model: "edited-model" }
    const latest = { ...configured, providersConfig: [active, hidden, edited, added], translate: { ...configured.translate, providerId: second.id }, language: { ...configured.language, targetCode: "jpn" } }
    await storage.setItem(key, latest)
    await store.set(moveProviderAtom, { providerId: second.id, beforeId: active.id })
    expect(await storage.getItem(key)).toEqual({ ...latest, providersConfig: [edited, active, hidden, added] })
    await store.set(moveProviderAtom, { providerId: second.id, beforeId: null })
    expect(await storage.getItem(key)).toEqual({ ...latest, providersConfig: [active, hidden, added, edited] })
  })

  it("does not resurrect a service or destination removed by another page", async () => {
    const store = await setup()
    const latest = { ...configured, providersConfig: [active] }
    await storage.setItem(key, latest)
    await expect(store.set(moveProviderAtom, { providerId: second.id, beforeId: active.id })).rejects.toThrow("no longer exists")
    expect(store.get(configAtom)).toEqual(latest)
    expect(await storage.getItem(key)).toEqual(latest)
  })

  it("restores the previous order on storage failure, then saves a retry without switching", async () => {
    const store = await setup()
    vi.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("Storage unavailable"))
    const action = { providerId: second.id, beforeId: active.id }
    await expect(store.set(moveProviderAtom, action)).rejects.toThrow("Storage unavailable")
    expect(store.get(configAtom)).toEqual(configured)
    expect(await storage.getItem(key)).toEqual(configured)
    await store.set(moveProviderAtom, action)
    expect(await storage.getItem(key)).toEqual({ ...configured, providersConfig: [second, active] })
  })

  it("saves a checked inactive edit against latest config without undoing a popup switch or settings change", async () => {
    const store = await setup()
    const latest: Config = { ...configured, language: { ...configured.language, targetCode: "jpn" }, translate: { ...configured.translate, providerId: second.id } }
    await storage.setItem(key, latest)
    const edited = { ...active, model: "new-model", connectionCheck: { ok: true, checkedAt: 2 } }
    await store.set(saveProviderAtom, { provider: edited, mode: "edit" })
    expect(await storage.getItem(key)).toEqual({ ...latest, providersConfig: [edited, second] })
  })

  it("preserves another service added while a connection check was running", async () => {
    const store = await setup()
    const concurrent = { ...second, id: "other", name: "Other account" }
    const candidate = { ...second, id: "added", name: "Added account" }
    await storage.setItem(key, { ...configured, providersConfig: [...configured.providersConfig, concurrent] })
    await store.set(saveProviderAtom, { provider: candidate, mode: "add" })
    const saved = await storage.getItem<Config>(key)
    expect(saved?.providersConfig).toEqual([...configured.providersConfig, concurrent, candidate])
    expect(saved?.translate.providerId).toBe(active.id)
  })

  it("serializes service additions and a selection with unrelated setting writes", async () => {
    const store = await setup()
    const added = { ...second, id: "added", name: "DeepSeek second account" }
    await Promise.all([
      store.set(saveProviderAtom, { provider: added, mode: "add" }),
      store.set(selectProviderAtom, second.id),
      store.set(writeConfigAtom, { reading: { wordPrefixEmphasis: true } }),
    ])
    const saved = await storage.getItem<Config>(key)
    expect(saved?.providersConfig).toEqual([...configured.providersConfig, added])
    expect(saved?.translate.providerId).toBe(second.id)
    expect(saved?.reading.wordPrefixEmphasis).toBe(true)
    expect(store.get(configAtom)).toEqual(saved)
  })

  it("activates the first configured service and removes the initial placeholder", async () => {
    const store = await setup(DEFAULT_CONFIG)
    await store.set(saveProviderAtom, { provider: second, mode: "add", makeCurrent: false })
    const saved = await storage.getItem<Config>(key)
    expect(saved?.providersConfig).toEqual([second])
    expect(saved?.translate.providerId).toBe(second.id)
  })

  it("uses the add checkbox to select a new checked service", async () => {
    const store = await setup()
    const added = { ...second, id: "added", name: "Added account" }
    await store.set(saveProviderAtom, { provider: added, mode: "add", makeCurrent: true })
    expect((await storage.getItem<Config>(key))?.translate.providerId).toBe(added.id)
  })

  it("keeps an unconfigured current service selected when editing a different account", async () => {
    const draft = { ...second, apiKey: undefined, connectionCheck: undefined }
    const initial = { ...DEFAULT_CONFIG, providersConfig: [...DEFAULT_CONFIG.providersConfig, draft] }
    const store = await setup(initial)
    await store.set(saveProviderAtom, { provider: second, mode: "edit", makeCurrent: true })
    expect((await storage.getItem<Config>(key))?.translate.providerId).toBe(DEFAULT_CONFIG.translate.providerId)
  })

  it("rejects removing the current service, then removes it after switching", async () => {
    const store = await setup()
    expect(() => store.set(removeProviderAtom, active.id)).toThrow("Switch to another service")
    expect(await storage.getItem(key)).toEqual(configured)
    await store.set(selectProviderAtom, second.id)
    await store.set(removeProviderAtom, active.id)
    expect((await storage.getItem<Config>(key))?.providersConfig).toEqual([second])
  })

  it("rejects selections with a missing key or model, disabled services and removed services", async () => {
    const variants = [{ ...second, apiKey: " " }, { ...second, model: " " }, { ...second, enabled: false }]
    for (const unavailable of variants) {
      const store = await setup({ ...configured, providersConfig: [active, unavailable] })
      expect(() => store.set(selectProviderAtom, second.id)).toThrow("unavailable")
    }
    const store = await setup()
    expect(() => store.set(selectProviderAtom, "removed")).toThrow("unavailable")
  })

  it("ignores a completed check if another editor changed or removed the tested service", async () => {
    const store = await setup()
    const edited = { ...second, model: "different-model", connectionCheck: undefined }
    await storage.setItem(key, { ...configured, providersConfig: [active, edited] })
    await store.set(saveProviderCheckAtom, { provider: second, check: { ok: false, checkedAt: 9, error: "Old model failed" } })
    expect((await storage.getItem<Config>(key))?.providersConfig[1]).toEqual(edited)
    await storage.setItem(key, { ...configured, providersConfig: [active] })
    await store.set(saveProviderCheckAtom, { provider: second, check: { ok: true, checkedAt: 10 } })
    expect((await storage.getItem<Config>(key))?.providersConfig).toEqual([active])
  })

  it("records a check without undoing a newer active selection", async () => {
    const store = await setup()
    await storage.setItem(key, { ...configured, translate: { ...configured.translate, providerId: second.id } })
    const check = { ok: false, checkedAt: 2, error: "Temporarily unavailable" }
    await store.set(saveProviderCheckAtom, { provider: second, check })
    const saved = await storage.getItem<Config>(key)
    expect(saved?.translate.providerId).toBe(second.id)
    expect(saved?.providersConfig[1].connectionCheck).toEqual(check)
  })

  it("rolls back a failed switch and allows retrying the same service", async () => {
    const store = await setup()
    vi.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("Storage unavailable"))
    await expect(store.set(selectProviderAtom, second.id)).rejects.toThrow("Storage unavailable")
    expect(store.get(configAtom)).toEqual(configured)
    expect(await storage.getItem(key)).toEqual(configured)
    await store.set(selectProviderAtom, second.id)
    expect((await storage.getItem<Config>(key))?.translate.providerId).toBe(second.id)
  })

  it("refuses a candidate that did not pass its connection check", async () => {
    const store = await setup()
    expect(() => store.set(saveProviderAtom, { provider: { ...second, connectionCheck: { ok: false, checkedAt: 2 } }, mode: "edit" }))
      .toThrow("pass a connection check")
    expect(await storage.getItem(key)).toEqual(configured)
  })

  it("does not recreate an edited service removed during its connection check", async () => {
    const store = await setup()
    await storage.setItem(key, { ...configured, providersConfig: [active] })
    await expect(store.set(saveProviderAtom, { provider: second, mode: "edit" })).rejects.toThrow("no longer exists")
    expect((await storage.getItem<Config>(key))?.providersConfig).toEqual([active])
    expect(store.get(configAtom).providersConfig).toEqual([active])
  })

  it("restores the latest selection when a previously inactive removal becomes invalid", async () => {
    const store = await setup()
    const latest = { ...configured, translate: { ...configured.translate, providerId: second.id } }
    await storage.setItem(key, latest)
    await expect(store.set(removeProviderAtom, second.id)).rejects.toThrow("Switch to another service")
    expect(await storage.getItem(key)).toEqual(latest)
    expect(store.get(configAtom)).toEqual(latest)
  })
})
