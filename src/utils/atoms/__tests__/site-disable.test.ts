import type { Config } from "@/types/config/config"
import { createStore } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { configAtom, setSiteDisabledAtom, writeConfigAtom } from "../config"

const key = `local:${CONFIG_STORAGE_KEY}` as const

afterEach(async () => {
  vi.restoreAllMocks()
  await storage.removeItem(key)
})

describe("popup website disable writes", () => {
  it("adds the visible host to the latest list while preserving settings absent from the popup snapshot", async () => {
    const store = createStore()
    const latest: Config = {
      ...DEFAULT_CONFIG,
      language: { ...DEFAULT_CONFIG.language, targetCode: "jpn" },
      features: { ...DEFAULT_CONFIG.features, videoSubtitles: true, disabledSites: ["other.test"] },
    }
    await storage.setItem(key, latest)
    await store.set(setSiteDisabledAtom, { url: "https://Video.Example.COM:8443/watch?id=1", disabled: true })
    expect(await storage.getItem(key)).toEqual({
      ...latest,
      features: { ...latest.features, disabledSites: [...latest.features.disabledSites, "video.example.com"] },
    })
  })

  it("serializes two sites and a subtitle toggle without losing any of them", async () => {
    const store = createStore()
    await storage.setItem(key, DEFAULT_CONFIG)
    await Promise.all([
      store.set(setSiteDisabledAtom, { url: "https://one.example/", disabled: true }),
      store.set(writeConfigAtom, { features: { videoSubtitles: true } }),
      store.set(setSiteDisabledAtom, { url: "https://two.example/", disabled: true }),
    ])
    const saved = await storage.getItem<Config>(key)
    expect(saved?.features.disabledSites).toEqual(["one.example", "two.example"])
    expect(saved?.features.videoSubtitles).toBe(true)
    expect(store.get(configAtom)).toEqual(saved)
  })

  it("does not duplicate an exclusion already saved by another settings context", async () => {
    const store = createStore()
    const latest: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, disabledSites: ["video.example.com"] } }
    await storage.setItem(key, latest)
    await store.set(setSiteDisabledAtom, { url: "https://video.example.com/watch/1", disabled: true })
    expect(await storage.getItem(key)).toEqual(latest)
  })

  it("removes only equivalent current-host domain rules, preserving other hosts and parent domains", async () => {
    const store = createStore()
    const keep = ["example.com", "other.example.com"] as const
    const latest: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, disabledSites: ["VIDEO.example.com.", ...keep] } }
    await storage.setItem(key, latest)
    await store.set(setSiteDisabledAtom, { url: "https://video.example.com/", disabled: false })
    expect((await storage.getItem<Config>(key))?.features.disabledSites).toEqual(keep)
  })

  it("rolls back a failed save and permits retrying the same site", async () => {
    const store = createStore()
    await storage.setItem(key, DEFAULT_CONFIG)
    vi.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("Storage unavailable"))
    const action = { url: "https://example.com/", disabled: true }
    await expect(store.set(setSiteDisabledAtom, action)).rejects.toThrow("Storage unavailable")
    expect(store.get(configAtom)).toEqual(DEFAULT_CONFIG)
    expect(await storage.getItem(key)).toEqual(DEFAULT_CONFIG)
    await store.set(setSiteDisabledAtom, action)
    expect((await storage.getItem<Config>(key))?.features.disabledSites).toEqual(["example.com"])
  })

  it("rejects pages without a web domain without overwriting storage", async () => {
    const store = createStore()
    await storage.setItem(key, DEFAULT_CONFIG)
    expect(() => store.set(setSiteDisabledAtom, { url: "file:///video.html", disabled: true })).toThrow("no website hostname")
    expect(await storage.getItem(key)).toEqual(DEFAULT_CONFIG)
  })
})
