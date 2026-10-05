// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { VideoSiteRule } from "@/types/config/video-site-rules"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { openOptionsPage } from "@/utils/navigation"
import { activeTabAtom } from "../atoms"
import { VideoTranslationControl } from "../components/video-translation-control"

vi.mock("@/utils/navigation", () => ({ openOptionsPage: vi.fn(() => Promise.resolve()) }))

const key = `local:${CONFIG_STORAGE_KEY}` as const
const label = "popup.videoSiteExclusion.label"

async function show(url = "https://video.example.com/watch/1", rules: VideoSiteRule[] = []) {
  const config: Config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoSubtitles: true, hoverTranslation: true, videoExcludedSites: rules } }
  await storage.setItem(key, config)
  const store = createStore()
  store.set(configAtom, config)
  store.set(activeTabAtom, { id: 7, url, translatable: /^(?:https?|file):/.test(url) })
  render(<Provider store={store}><VideoTranslationControl /></Provider>)
  fireEvent.click(screen.getByText("popup.videoSubtitles", { selector: "summary" }))
  await waitFor(() => expect(screen.getByRole("switch", { name: "features.video" })).toBeChecked())
  return config
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await storage.removeItem(key)
})

describe("popup current-site video exclusion switch", () => {
  it("adds and removes the current host without touching the global switch or unrelated rules", async () => {
    const rule: VideoSiteRule = { type: "domain", value: "other.example" }
    const config = await show(undefined, [rule])
    const toggle = screen.getByRole("switch", { name: label })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAttribute("title", "video.example.com\npopup.videoSiteExclusion.description")
    expect(toggle).toHaveAccessibleDescription("video.example.com\npopup.videoSiteExclusion.description")
    expect(screen.queryByRole("button", { name: "popup.videoSiteExclusion.manage" })).toBeNull()
    fireEvent.click(toggle)
    await waitFor(async () => expect((await storage.getItem<Config>(key))?.features.videoExcludedSites).toEqual([rule, { type: "domain", value: "video.example.com" }]))
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toBeChecked()
    expect(screen.getByRole("switch", { name: "features.video" })).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(async () => expect(await storage.getItem(key)).toEqual(config))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it.each<VideoSiteRule>([
    { type: "domain", value: "example.com" },
    { type: "pattern", value: "*://*.example.com/watch/*" },
    { type: "regex", value: "^https://video\\.example\\.com/watch/" },
  ])("shows a managed exclusion instead of removing a wider $type rule", async (rule) => {
    const config = await show(undefined, [rule])
    const toggle = screen.getByRole("switch", { name: label })
    expect(toggle).toBeChecked()
    expect(toggle).toBeDisabled()
    expect(screen.getByText("popup.videoSiteExclusion.managed")).toBeVisible()
    fireEvent.click(toggle)
    expect(await storage.getItem(key)).toEqual(config)
    fireEvent.click(screen.getByRole("button", { name: "popup.videoSiteExclusion.manage" }))
    expect(openOptionsPage).toHaveBeenCalledWith({ section: "features" })
  })

  it("reflects changes saved in settings while open", async () => {
    const config = await show()
    const toggle = screen.getByRole("switch", { name: label })
    expect(toggle).not.toBeChecked()
    await storage.setItem(key, { ...config, features: { ...config.features, videoExcludedSites: [{ type: "domain", value: "video.example.com" }] } })
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
    expect(screen.getByText("popup.videoSiteExclusion.unavailable")).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText("popup.videoSiteExclusion.saving")).toBeInTheDocument())
    expect(toggle).toBeDisabled()
    await waitFor(() => expect(rejectSave).toBeDefined())
    rejectSave(new Error("Storage unavailable"))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("videoSiteRules.saveFailed"))
    expect(toggle).not.toBeChecked()
    expect(toggle).toBeEnabled()
    expect(await storage.getItem(key)).toEqual(config)
    fireEvent.click(toggle)
    await waitFor(async () => expect((await storage.getItem<Config>(key))?.features.videoExcludedSites).toEqual([{ type: "domain", value: "video.example.com" }]))
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(screen.queryByRole("status")).toBeNull()
  })
})
