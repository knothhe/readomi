// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { toast } from "@/components/toast"
import { configAtom } from "@/utils/atoms/config"
import { storageAdapter } from "@/utils/atoms/storage-adapter"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { ShortcutSection } from ".."

const customized: Config = {
  ...DEFAULT_CONFIG,
  translate: {
    ...DEFAULT_CONFIG.translate,
    page: { shortcut: "Alt+T" },
    enableAIContentAware: true,
  },
  features: {
    ...DEFAULT_CONFIG.features,
    // The page default is currently assigned to another action; restore must be one write.
    modeShortcut: "Alt+E",
    subtitlesShortcut: "Alt+V",
    hoverHotkey: "shift",
    videoSubtitles: true,
    subtitleMode: "translationOnly",
  },
}

async function renderShortcuts(config = customized) {
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  render(<Provider store={store}><ShortcutSection /></Provider>)
  return store
}

describe("shortcut defaults", () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("restores all three shortcuts atomically and preserves the other preferences", async () => {
    const store = await renderShortcuts()
    fireEvent.click(screen.getByRole("button", { name: "translationShortcuts.restoreDefaults" }))

    const expected: Config = {
      ...customized,
      translate: { ...customized.translate, page: { ...customized.translate.page, shortcut: DEFAULT_CONFIG.translate.page.shortcut } },
      features: { ...customized.features, modeShortcut: DEFAULT_CONFIG.features.modeShortcut, subtitlesShortcut: DEFAULT_CONFIG.features.subtitlesShortcut },
    }
    await waitFor(async () => {
      expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(expected)
    })
    expect(store.get(configAtom)).toEqual(expected)
    expect(screen.getByLabelText("options.shortcut.togglePage")).toHaveAttribute("data-shortcut", DEFAULT_CONFIG.translate.page.shortcut)
    expect(screen.getByLabelText("translationShortcuts.mode")).toHaveAttribute("data-shortcut", "Alt+M")
    expect(screen.getByLabelText("translationShortcuts.subtitles")).toHaveAttribute("data-shortcut", "Alt+V")
  })

  it("clears a conflict and cancels an active recording when restoring", async () => {
    const store = await renderShortcuts()
    const mode = () => screen.getByLabelText("translationShortcuts.mode")
    fireEvent.click(mode())
    fireEvent.keyDown(document, { key: "t", altKey: true })
    expect(screen.getByRole("alert")).toHaveTextContent("translationShortcuts.conflict")

    fireEvent.click(mode())
    expect(mode()).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "translationShortcuts.restoreDefaults" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(mode()).toHaveAttribute("aria-pressed", "false")
    fireEvent.keyDown(document, { key: "k", altKey: true })
    await waitFor(async () => {
      expect(store.get(configAtom).features.modeShortcut).toBe(DEFAULT_CONFIG.features.modeShortcut)
      expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.modeShortcut).toBe(DEFAULT_CONFIG.features.modeShortcut)
    })
    expect(mode()).toHaveAttribute("data-shortcut", "Alt+M")
  })

  it("preserves newer stored preferences while the settings page still shows older values", async () => {
    vi.spyOn(storageAdapter, "watch").mockReturnValue(() => {})
    const store = await renderShortcuts()
    await act(async () => {
      await Promise.resolve()
    })
    const newer: Config = {
      ...customized,
      translate: { ...customized.translate, mode: "translationOnly", enableAIContentAware: false },
      features: { ...customized.features, hoverHotkey: "control", hoverStream: false, videoSubtitles: false },
    }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, newer)
    expect(store.get(configAtom)).toEqual(customized)

    fireEvent.click(screen.getByRole("button", { name: "translationShortcuts.restoreDefaults" }))
    const expected: Config = {
      ...newer,
      translate: { ...newer.translate, page: { ...newer.translate.page, shortcut: DEFAULT_CONFIG.translate.page.shortcut } },
      features: { ...newer.features, modeShortcut: DEFAULT_CONFIG.features.modeShortcut, subtitlesShortcut: DEFAULT_CONFIG.features.subtitlesShortcut },
    }
    await waitFor(async () => {
      expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(expected)
    })
    expect(store.get(configAtom)).toEqual(expected)
  })

  it("keeps the saved shortcuts and allows retry if storage fails", async () => {
    const store = await renderShortcuts()
    vi.spyOn(storageAdapter, "set").mockRejectedValueOnce(new Error("Storage unavailable"))
    const errorToast = vi.spyOn(toast, "error").mockReturnValue(1)
    const restore = screen.getByRole("button", { name: "translationShortcuts.restoreDefaults" })
    fireEvent.click(restore)

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith("translationShortcuts.restoreFailed"))
    expect(store.get(configAtom)).toEqual(customized)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(customized)
    expect(screen.getByLabelText("translationShortcuts.mode")).toHaveAttribute("data-shortcut", "Alt+E")
    expect(restore).toBeEnabled()
  })
})
