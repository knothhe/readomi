// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { storageAdapter } from "@/utils/atoms/storage-adapter"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { openOptionsPage } from "@/utils/navigation"
import { PopupFooter } from "../components/popup-footer"

vi.mock("@/utils/navigation", () => ({ openOptionsPage: vi.fn(() => Promise.resolve()) }))

const first = { ...DEFAULT_CONFIG.providersConfig[0], id: "first", name: "DeepSeek", model: "deepseek-chat", apiKey: "first-test-key", enabled: true }
const second = { ...first, id: "second", name: "Gemini", model: "gemini-test", apiKey: "second-test-key" }
const config: Config = {
  ...DEFAULT_CONFIG,
  providersConfig: [first, second, { ...first, id: "disabled", name: "Disabled", enabled: false }, { ...first, id: "no-key", name: "No key", apiKey: "" }],
  translate: { ...DEFAULT_CONFIG.translate, providerId: first.id, mode: "translationOnly", enableAIContentAware: true },
}

async function renderFooter(candidate = config) {
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, candidate)
  const store = createStore()
  store.set(configAtom, candidate)
  render(<Provider store={store}><PopupFooter /></Provider>)
  await waitFor(() => expect(screen.getByTitle(`${first.name} · ${first.model}`)).toBeInTheDocument())
  return store
}

describe("popup service switch", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it("lists only configured enabled services and persists one shared selection", async () => {
    const store = await renderFooter()
    fireEvent.click(screen.getByRole("button", { name: "popup.serviceSwitch.switchLabel" }))
    const menu = screen.getByRole("menu", { name: "popup.serviceSwitch.title" })
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2)
    expect(within(menu).getByRole("menuitemradio", { name: /DeepSeek/ })).toHaveAttribute("aria-checked", "true")
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Gemini/ }))

    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.translate).toEqual({ ...config.translate, providerId: second.id }))
    expect(store.get(configAtom).providersConfig).toEqual(config.providersConfig)
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent("popup.serviceSwitch.switchedDescription")
    expect(screen.getByTitle(`${second.name} · ${second.model}`)).toHaveTextContent(second.name)
    expect(screen.getByRole("button", { name: "popup.serviceSwitch.switchLabel" })).toHaveFocus()
  })

  it("shows the previous service until the new selection has been saved", async () => {
    await renderFooter()
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const originalSet = storageAdapter.set
    const set = vi.spyOn(storageAdapter, "set").mockImplementationOnce(async (key, value, schema) => {
      await gate
      await originalSet(key, value, schema)
    })
    fireEvent.click(screen.getByRole("button", { name: "popup.serviceSwitch.switchLabel" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Gemini/ }))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))

    expect(screen.getByRole("button", { name: "popup.serviceSwitch.switchLabel" })).toBeDisabled()
    expect(screen.getByTitle(`${first.name} · ${first.model}`)).toHaveTextContent(first.name)
    expect(screen.queryByRole("status")).toBeNull()
    finish()
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("popup.serviceSwitch.switched"))
    expect(screen.getByTitle(`${second.name} · ${second.model}`)).toHaveTextContent(second.name)
  })

  it("keeps the current service after a failed save and allows retrying", async () => {
    const store = await renderFooter()
    vi.spyOn(storageAdapter, "set").mockRejectedValueOnce(new Error("Storage unavailable"))
    fireEvent.click(screen.getByRole("button", { name: "popup.serviceSwitch.switchLabel" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Gemini/ }))

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("popup.serviceSwitch.failed"))
    expect(store.get(configAtom).translate.providerId).toBe(first.id)
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.translate.providerId).toBe(first.id)
    expect(screen.getByTitle(`${first.name} · ${first.model}`)).toHaveTextContent(first.name)
    fireEvent.click(screen.getByRole("button", { name: "popup.serviceSwitch.retry" }))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("popup.serviceSwitch.switched"))
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.translate.providerId).toBe(second.id)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("supports keyboard navigation, dismisses outside clicks and opens service management", async () => {
    await renderFooter()
    const trigger = screen.getByRole("button", { name: "popup.serviceSwitch.switchLabel" })
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const firstOption = screen.getByRole("menuitemradio", { name: /DeepSeek/ })
    expect(firstOption).toHaveFocus()
    fireEvent.keyDown(firstOption, { key: "ArrowDown" })
    const secondOption = screen.getByRole("menuitemradio", { name: /Gemini/ })
    expect(secondOption).toHaveFocus()
    fireEvent.keyDown(secondOption, { key: "End" })
    expect(screen.getByRole("menuitem", { name: "popup.serviceSwitch.manage" })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("menuitem", { name: "popup.serviceSwitch.manage" }))
    expect(openOptionsPage).toHaveBeenCalledWith({ section: "service" })
  })

  it("reflects a current-service change from settings while the popup is open", async () => {
    await renderFooter()
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, { ...config, translate: { ...config.translate, providerId: second.id } })
    await waitFor(() => expect(screen.getByTitle(`${second.name} · ${second.model}`)).toHaveTextContent(second.name))
    fireEvent.click(screen.getByRole("button", { name: "popup.serviceSwitch.switchLabel" }))
    expect(screen.getByRole("menuitemradio", { name: /Gemini/ })).toHaveAttribute("aria-checked", "true")
  })
})
