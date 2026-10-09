import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { browser, storage } from "#imports"
import * as configStorage from "@/utils/config/storage"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { setHostPreviewConfig, watchHostConfig } from "../preview-config"

let unwatch: (() => void) | undefined

beforeEach(async () => {
  fakeBrowser.reset()
  await setHostPreviewConfig(null)
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, DEFAULT_CONFIG)
})

afterEach(() => {
  unwatch?.()
  unwatch = undefined
  vi.restoreAllMocks()
})

it("does not read storage when preview cleanup runs after extension invalidation", async () => {
  const callback = vi.fn()
  unwatch = watchHostConfig(callback)
  const read = vi.spyOn(configStorage, "getLocalConfig")
  vi.spyOn(browser.runtime, "id", "get").mockReturnValue("")

  await expect(setHostPreviewConfig(null)).resolves.toBeUndefined()
  expect(read).not.toHaveBeenCalled()
  expect(callback).not.toHaveBeenCalled()
})

it("handles invalidation while an overlay notification is reading storage", async () => {
  const callback = vi.fn()
  unwatch = watchHostConfig(callback)
  vi.spyOn(configStorage, "getLocalConfig").mockRejectedValue(new Error("Extension context invalidated."))

  await expect(setHostPreviewConfig(null)).resolves.toBeUndefined()
  expect(callback).not.toHaveBeenCalled()
})

it("still reports storage errors while the extension is running", async () => {
  unwatch = watchHostConfig(vi.fn())
  vi.spyOn(configStorage, "getLocalConfig").mockRejectedValue(new Error("Storage unavailable"))

  await expect(setHostPreviewConfig(null)).rejects.toThrow("Storage unavailable")
})
