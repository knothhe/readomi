// @vitest-environment jsdom

import { createStore } from "jotai"
import { afterEach, expect, it, vi } from "vitest"
import { browser, storage } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { logger } from "@/utils/logger"
import { configAtom } from "../config"

const runtimeId = Object.getOwnPropertyDescriptor(browser.runtime, "id")!
const browserI18n = Object.getOwnPropertyDescriptor(browser, "i18n")!

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(browser.runtime, "id", runtimeId)
  Object.defineProperty(browser, "i18n", browserI18n)
})

it("unmounts the config atom even when Chrome rejects removal of its storage listener", async () => {
  vi.spyOn(storage, "getItem").mockResolvedValue(DEFAULT_CONFIG)
  vi.spyOn(storage, "watch").mockReturnValue(() => {
    throw new Error("Extension context invalidated.")
  })
  const store = createStore()
  const off = store.sub(configAtom, () => {})
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(() => off()).not.toThrow()
})

it("catches a pending config read when the extension is unloaded", async () => {
  let reject!: (error: Error) => void
  vi.spyOn(storage, "getItem").mockReturnValue(new Promise((_, fail) => reject = fail))
  vi.spyOn(storage, "watch").mockReturnValue(() => {})
  const log = vi.spyOn(logger, "error")
  const store = createStore()
  const off = store.sub(configAtom, () => {})
  await Promise.resolve()
  Object.defineProperty(browser.runtime, "id", { configurable: true, value: undefined })
  reject(new Error("Extension context invalidated."))
  off()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(log).not.toHaveBeenCalled()
})

it("reports a config sync failure while the extension is still valid", async () => {
  vi.spyOn(storage, "getItem").mockRejectedValue(new Error("Storage unavailable"))
  vi.spyOn(storage, "watch").mockReturnValue(() => {})
  const log = vi.spyOn(logger, "error")
  const off = createStore().sub(configAtom, () => {})
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(log).toHaveBeenCalledWith("Failed to sync config from storage:", expect.any(Error))
  off()
})
