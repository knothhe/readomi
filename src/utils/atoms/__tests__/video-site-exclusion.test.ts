import type { Config } from "@/types/config/config"
import { createStore } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { configAtom, setVideoSiteExclusionAtom, writeConfigAtom } from "../config"

const key = `local:${CONFIG_STORAGE_KEY}` as const

afterEach(async () => {
  vi.restoreAllMocks()
  await storage.removeItem(key)
})

describe("popup video site exclusion writes", () => {
  it("adds the visible host to the latest list while preserving settings absent from the popup snapshot", async () => {
    const store = createStore()
    const latest: Config = {
      ...DEFAULT_CONFIG,
      language: { ...DEFAULT_CONFIG.language, targetCode: "jpn" },
      features: { ...DEFAULT_CONFIG.features, videoSubtitles: true, videoExcludedSites: [{ type: "regex", value: "other\\.test" }] },
    }
    await storage.setItem(key, latest)
    await store.set(setVideoSiteExclusionAtom, { url: "https://Video.Example.COM:8443/watch?id=1", excluded: true })
    expect(await storage.getItem(key)).toEqual({
      ...latest,
      features: { ...latest.features, videoExcludedSites: [...latest.features.videoExcludedSites, { type: "domain", value: "video.example.com" }] },
    })
  })

  it("serializes two sites and a subtitle toggle without losing any of them", async () => {
    const store = createStore()
    await storage.setItem(key, DEFAULT_CONFIG)
    await Promise.all([
      store.set(setVideoSiteExclusionAtom, { url: "https://one.example/", excluded: true }),
      store.set(writeConfigAtom, { features: { videoSubtitles: true } }),
      store.set(setVideoSiteExclusionAtom, { url: "https://two.example/", excluded: true }),
    ])
    const saved = await storage.getItem<Config>(key)
    expect(saved?.features.videoExcludedSites).toEqual([{ type: "domain", value: "one.example" }, { type: "domain", value: "two.example" }])
    expect(saved?.features.videoSubtitles).toBe(true)
    expect(store.get(configAtom)).toEqual(saved)
  })

  it("does not duplicate an exclusion already saved by another settings context", async () => {
    const store = createStore()
    const latest: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoExcludedSites: [{ type: "pattern", value: "*://*.example.com/watch/*" }] } }
    await storage.setItem(key, latest)
    await store.set(setVideoSiteExclusionAtom, { url: "https://video.example.com/watch/1", excluded: true })
    expect(await storage.getItem(key)).toEqual(latest)
  })

  it("removes only equivalent current-host domain rules, preserving parent domains and URL rules", async () => {
    const store = createStore()
    const keep = [{ type: "domain", value: "example.com" }, { type: "regex", value: "video\\.example\\.com" }] as const
    const latest: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoExcludedSites: [{ type: "domain", value: "VIDEO.example.com." }, ...keep] } }
    await storage.setItem(key, latest)
    await store.set(setVideoSiteExclusionAtom, { url: "https://video.example.com/", excluded: false })
    expect((await storage.getItem<Config>(key))?.features.videoExcludedSites).toEqual(keep)
  })

  it("rolls back a failed save and permits retrying the same site", async () => {
    const store = createStore()
    await storage.setItem(key, DEFAULT_CONFIG)
    vi.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("Storage unavailable"))
    const action = { url: "https://example.com/", excluded: true }
    await expect(store.set(setVideoSiteExclusionAtom, action)).rejects.toThrow("Storage unavailable")
    expect(store.get(configAtom)).toEqual(DEFAULT_CONFIG)
    expect(await storage.getItem(key)).toEqual(DEFAULT_CONFIG)
    await store.set(setVideoSiteExclusionAtom, action)
    expect((await storage.getItem<Config>(key))?.features.videoExcludedSites).toEqual([{ type: "domain", value: "example.com" }])
  })

  it("rejects pages without a web domain without overwriting storage", async () => {
    const store = createStore()
    await storage.setItem(key, DEFAULT_CONFIG)
    expect(() => store.set(setVideoSiteExclusionAtom, { url: "file:///video.html", excluded: true })).toThrow("no video translation domain")
    expect(await storage.getItem(key)).toEqual(DEFAULT_CONFIG)
  })
})
