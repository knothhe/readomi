import type { Config } from "@/types/config/config"
import { TextEncoder as NativeTextEncoder } from "node:util"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { applySyncedConfig, decodeSyncConfig, encodeSyncConfig, mergeSyncedConfig, parseSyncedConfig, SYNC_MANIFEST_KEY, SYNC_PREFIX, toSyncedConfig } from "../sync-data"

beforeEach(() => vi.stubGlobal("TextEncoder", NativeTextEncoder))
afterEach(() => vi.unstubAllGlobals())

function configured(): Config {
  return { ...structuredClone(DEFAULT_CONFIG), providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "secret-key", headers: { Authorization: "secret-header" }, body: { token: "secret-body" }, connectionCheck: { ok: false, checkedAt: 1, error: "secret-error" } })) }
}

describe("configuration sync payload", () => {
  it("only exports the explicit service metadata allowlist", async () => {
    const document = toSyncedConfig(configured())
    const encoded = await encodeSyncConfig(document, {})
    expect(JSON.stringify(encoded.values)).not.toMatch(/secret|apiKey|headers|body|connectionCheck/)
    expect((await decodeSyncConfig(encoded.values))?.config).toEqual(document)
  })
  it("syncs the no-key setting without restoring an old local key", async () => {
    const local = configured()
    const remote = toSyncedConfig(local)
    remote.providersConfig[0].noApiKey = true
    const encoded = await encodeSyncConfig(remote, {})
    const decoded = (await decodeSyncConfig(encoded.values))!.config
    expect(decoded.providersConfig[0].noApiKey).toBe(true)
    const applied = applySyncedConfig(local, decoded)
    expect(applied.providersConfig[0]).not.toHaveProperty("apiKey")
    expect(applied.providersConfig[0].noApiKey).toBe(true)
  })
  it("rejects cloud credentials rather than importing them", () => {
    expect(() => parseSyncedConfig(configured())).toThrow("invalid")
  })
  it.each(["https://user:secret@example.com/v1", "https://example.com/v1?api_key=secret", "https://example.com/v1#secret"])("does not publish endpoint credentials in %s", (baseURL) => {
    const local = configured()
    local.providersConfig[0].baseURL = baseURL
    expect(() => toSyncedConfig(local)).toThrow("invalid")
  })
  it("refuses unknown future fields rather than silently deleting them", () => {
    const publicConfig = toSyncedConfig(DEFAULT_CONFIG)
    expect(() => parseSyncedConfig({ ...publicConfig, futureSetting: true })).toThrow("invalid")
    expect(() => parseSyncedConfig({ ...publicConfig, reading: { ...publicConfig.reading, futureSetting: true } })).toThrow("invalid")
  })
  it("keeps keys, headers and parameters for the same service and endpoint", () => {
    const local = configured()
    const remote = toSyncedConfig(local)
    remote.providersConfig[0].model = "new-model"
    const applied = applySyncedConfig(local, remote)
    expect(applied.providersConfig[0]).toMatchObject({ model: "new-model", apiKey: "secret-key", headers: local.providersConfig[0].headers, body: local.providersConfig[0].body })
    expect(applied.providersConfig[0].connectionCheck).toBeUndefined()
  })
  it("keeps credentials when an explicit official URL matches the previous default endpoint", () => {
    const local = configured()
    const remote = toSyncedConfig(local)
    remote.providersConfig[0].baseURL = "https://api.openai.com/v1/"
    expect(applySyncedConfig(local, remote).providersConfig[0].apiKey).toBe("secret-key")
  })
  it("drops all local credentials when a remote edit changes the endpoint or provider id", () => {
    for (const field of ["baseURL", "id"] as const) {
      const local = configured()
      const remote = toSyncedConfig(local)
      remote.providersConfig[0][field] = field === "baseURL" ? "https://other.example/v1" : "another-service"
      if (field === "id")
        remote.translate.providerId = remote.providersConfig[0].id
      const provider = applySyncedConfig(local, remote).providersConfig[0]
      for (const secret of ["apiKey", "headers", "body", "connectionCheck"])
        expect(provider).not.toHaveProperty(secret)
    }
  })
  it("merges pending edits to different preferences and keeps a pending local edit on the same field", () => {
    const base = toSyncedConfig(DEFAULT_CONFIG)
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.features.hoverTranslation = true
    local.appearance.mode = "dark"
    remote.language.targetCode = "eng"
    remote.appearance.mode = "light"
    const before = structuredClone(remote)
    const merged = mergeSyncedConfig(base, local, remote)
    expect(merged.features.hoverTranslation).toBe(true)
    expect(merged.language.targetCode).toBe("eng")
    expect(merged.appearance.mode).toBe("dark")
    expect(remote).toEqual(before)
  })
  it("keeps provider selection consistent when services are changed concurrently", () => {
    const base = toSyncedConfig(DEFAULT_CONFIG)
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.providersConfig[0].name = "Renamed locally"
    remote.providersConfig[0].id = "remote-id"
    remote.translate.providerId = "remote-id"
    const merged = mergeSyncedConfig(base, local, remote)
    expect(merged.translate.providerId).toBe(base.translate.providerId)
    expect(merged.providersConfig[0].name).toBe("Renamed locally")
  })
  it("merges independent model selections made on two devices", () => {
    const base = toSyncedConfig(DEFAULT_CONFIG)
    base.providersConfig.push({ ...base.providersConfig[0], id: "alternate", name: "Alternate" })
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.translate.modelProviders.page = "alternate"
    remote.translate.modelProviders.hover = "alternate"
    remote.translate.modelProviders.input = "alternate"
    const merged = mergeSyncedConfig(base, local, remote)
    expect(merged.translate.modelProviders).toEqual({ page: "alternate", hover: "alternate", video: null, input: "alternate" })
  })
  it("keeps model assignments with the service list when sync edits conflict", () => {
    const base = toSyncedConfig(DEFAULT_CONFIG)
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.providersConfig.push({ ...local.providersConfig[0], id: "local-model", name: "Local model" })
    local.translate.modelProviders.hover = "local-model"
    remote.providersConfig = [{ ...remote.providersConfig[0], id: "remote-model", name: "Remote model" }]
    remote.translate.providerId = "remote-model"
    remote.translate.modelProviders.video = "remote-model"
    const merged = mergeSyncedConfig(base, local, remote)
    expect(merged.providersConfig).toEqual(local.providersConfig)
    expect(merged.translate.modelProviders).toEqual(local.translate.modelProviders)
    expect(parseSyncedConfig(merged)).toEqual(merged)
  })
  it("keeps input and page shortcuts consistent when devices choose the same combination", () => {
    const base = toSyncedConfig(DEFAULT_CONFIG)
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.features.inputTranslationShortcut = "Alt+I"
    remote.translate.page.shortcut = "Alt+I"
    const merged = mergeSyncedConfig(base, local, remote)
    expect(merged.features.inputTranslationShortcut).toBe("Alt+I")
    expect(merged.translate.page.shortcut).toBe(base.translate.page.shortcut)
    expect(parseSyncedConfig(merged)).toEqual(merged)
  })
  it.each([true, false])("keeps the input trigger with its shortcut when the custom trigger is edited locally: %s", (inputEditedLocally) => {
    const base = toSyncedConfig(DEFAULT_CONFIG)
    const local = structuredClone(base)
    const remote = structuredClone(base)
    const inputSide = inputEditedLocally ? local : remote
    const pageSide = inputEditedLocally ? remote : local
    inputSide.features.inputTranslationTrigger = "shortcut"
    inputSide.features.inputTranslationShortcut = "Alt+I"
    pageSide.translate.page.shortcut = "Alt+P"
    const merged = mergeSyncedConfig(base, local, remote)
    expect(merged.features.inputTranslationTrigger).toBe(local.features.inputTranslationTrigger)
    expect(merged.features.inputTranslationShortcut).toBe(local.features.inputTranslationShortcut)
    expect(merged.translate.page.shortcut).toBe(local.translate.page.shortcut)
    expect(parseSyncedConfig(merged)).toEqual(merged)
  })
  it("splits multibyte and escaped content below the per-item quota", async () => {
    const config = toSyncedConfig(DEFAULT_CONFIG)
    config.siteRules.userRules = [{ id: "long", matches: "example.com", description: "汉字😀\\\"\n".repeat(2000) }]
    const { values } = await encodeSyncConfig(config, {})
    expect(Object.keys(values).length).toBeGreaterThan(2)
    for (const [key, value] of Object.entries(values))
      expect(new TextEncoder().encode(key + JSON.stringify(value)).length).toBeLessThanOrEqual(8192)
    expect((await decodeSyncConfig(values))?.config).toEqual(config)
  })
  it("preserves the previous snapshot when total capacity would be exceeded", async () => {
    const config = toSyncedConfig(DEFAULT_CONFIG)
    const previous = (await encodeSyncConfig(config, {})).values
    config.siteRules.userRules = [{ id: "long", matches: "example.com", description: "字".repeat(40000) }]
    await expect(encodeSyncConfig(config, previous)).rejects.toThrow("quota")
    expect(await decodeSyncConfig(previous)).not.toBeNull()
  })
  it("refuses mixed generations and missing chunks until the whole snapshot arrives", async () => {
    const before = toSyncedConfig(DEFAULT_CONFIG)
    const old = await encodeSyncConfig(before, {})
    const next = structuredClone(before)
    next.features.hoverTranslation = true
    const updated = await encodeSyncConfig(next, old.values)
    await expect(decodeSyncConfig({ ...old.values, [SYNC_MANIFEST_KEY]: updated.values[SYNC_MANIFEST_KEY] })).rejects.toThrow("invalid")
    await expect(decodeSyncConfig({ [SYNC_MANIFEST_KEY]: updated.values[SYNC_MANIFEST_KEY] })).rejects.toThrow("invalid")
    expect((await decodeSyncConfig(updated.values))?.config.features.hoverTranslation).toBe(true)
  })
  it("reclaims obsolete chunk contents within the same write", async () => {
    const config = toSyncedConfig(DEFAULT_CONFIG)
    config.siteRules.userRules = [{ id: "long", matches: "example.com", description: "x".repeat(20000) }]
    const old = await encodeSyncConfig(config, {})
    const small = await encodeSyncConfig(toSyncedConfig(DEFAULT_CONFIG), old.values)
    expect(small.values[`${SYNC_PREFIX}2`]).toBeNull()
    expect((await decodeSyncConfig({ ...old.values, ...small.values }))?.config).toEqual(toSyncedConfig(DEFAULT_CONFIG))
  })
})
