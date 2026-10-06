// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { activeTabAtom } from "../atoms"
import { SiteDisableControl } from "../components/site-disable-control"

const key = `local:${CONFIG_STORAGE_KEY}` as const
const label = "popup.siteDisable.label"

async function show(url = "https://video.example.com/watch/1", rules: string[] = []) {
  const config: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoSubtitles: true, hoverTranslation: true, disabledSites: rules } }
  await storage.setItem(key, config)
  const store = createStore()
  store.set(configAtom, config)
  store.set(activeTabAtom, { id: 7, url, translatable: /^(?:https?|file):/.test(url) })
  render(<Provider store={store}><SiteDisableControl /></Provider>)
  await waitFor(() => expect(screen.getByRole("switch", { name: label })).toBeInTheDocument())
  return config
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await storage.removeItem(key)
})

describe("popup website disable switch", () => {
  it("adds and removes the current host without touching the global switch or unrelated rules", async () => {
    const rule = "other.example"
    const config = await show(undefined, [rule])
    const toggle = screen.getByRole("switch", { name: label })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAttribute("title", "video.example.com\npopup.siteDisable.description")
    expect(toggle).toHaveAccessibleDescription("video.example.com\npopup.siteDisable.description")
    fireEvent.click(toggle)
    await waitFor(async () => expect((await storage.getItem<Config>(key))?.features.disabledSites).toEqual([rule, "video.example.com"]))
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toBeChecked()
    expect((await storage.getItem<Config>(key))?.features.videoSubtitles).toBe(true)
    fireEvent.click(toggle)
    await waitFor(async () => expect(await storage.getItem(key)).toEqual(config))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it("reflects changes saved in settings while open", async () => {
    const config = await show()
    const toggle = screen.getByRole("switch", { name: label })
    expect(toggle).not.toBeChecked()
    await storage.setItem(key, { ...config, features: { ...config.features, disabledSites: ["video.example.com"] } })
    await waitFor(() => expect(toggle).toBeChecked())
    expect(toggle).toBeEnabled()
    await storage.setItem(key, config)
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it.each(["chrome://newtab/", "file:///video.html", "not a URL"])("disables the exclusion switch for %s", async (url) => {
    const config = await show(url)
    const toggle = screen.getByRole("switch", { name: label })
    expect(toggle).toBeDisabled()
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole("status")).toHaveTextContent("popup.siteDisable.unavailable")
    fireEvent.click(toggle)
    expect(await storage.getItem(key)).toEqual(config)
  })

  it("disables repeated clicks during saving and rolls back with a retryable error on failure", async () => {
    const config = await show()
    let rejectSave!: (error: Error) => void
    vi.spyOn(storage, "setItem").mockImplementationOnce(() => new Promise<void>((_, reject) => {
      rejectSave = reject
    }))
    const toggle = screen.getByRole("switch", { name: label })
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByText("popup.siteDisable.saving")).toHaveClass("sr-only"))
    expect(toggle).toBeDisabled()
    await waitFor(() => expect(rejectSave).toBeDefined())
    rejectSave(new Error("Storage unavailable"))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("popup.siteDisable.failed"))
    expect(toggle).not.toBeChecked()
    expect(toggle).toBeEnabled()
    expect(await storage.getItem(key)).toEqual(config)
    fireEvent.click(toggle)
    await waitFor(async () => expect((await storage.getItem<Config>(key))?.features.disabledSites).toEqual(["video.example.com"]))
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(screen.getByRole("status")).toHaveTextContent("popup.siteDisable.disabled")
  })
})
