// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { ModelSelection } from "../model-selection"

const first = { ...DEFAULT_CONFIG.providersConfig[0], apiKey: "test-key", model: "model-a", name: "Service A" }
const second = { ...first, id: "second", model: "model-b", name: "Service B" }
const config = { ...DEFAULT_CONFIG, providersConfig: [first, second] }
async function setup() {
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  render(<Provider store={store}><ModelSelection onAdd={vi.fn()} /></Provider>)
  return store
}
function chooseHover() {
  fireEvent.click(screen.getByRole("combobox", { name: "translationModels.hover" }))
  fireEvent.click(screen.getByRole("option", { name: "Service B · model-b" }))
}
beforeEach(() => fakeBrowser.reset())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("model selection saves", () => {
  it("saves just the selected feature and keeps the current service and other settings", async () => {
    const store = await setup()
    chooseHover()
    await waitFor(() => expect(screen.getByRole("combobox", { name: "translationModels.hover" })).not.toBeDisabled())
    const expected = { ...config, translate: { ...config.translate, modelProviders: { ...config.translate.modelProviders, hover: second.id } } }
    expect(store.get(configAtom)).toEqual(expected)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(expected)
  })
  it("assigns an input model independently and can follow the current service again", async () => {
    const store = await setup()
    const select = () => screen.getByRole("combobox", { name: "translationModels.input" })
    fireEvent.click(select())
    fireEvent.click(screen.getByRole("option", { name: "Service B · model-b" }))
    await waitFor(() => expect(store.get(configAtom).translate.modelProviders.input).toBe(second.id))
    expect(store.get(configAtom).translate.providerId).toBe(config.translate.providerId)
    expect(store.get(configAtom).translate.modelProviders.page).toBeNull()
    fireEvent.click(select())
    fireEvent.click(screen.getAllByRole("option")[0])
    await waitFor(async () => expect((await storage.getItem<typeof config>(`local:${CONFIG_STORAGE_KEY}`))?.translate.modelProviders.input).toBeNull())
  })
  it("restores the previous choice and exposes retryable controls after a storage failure", async () => {
    const store = await setup()
    vi.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("storage unavailable"))
    chooseHover()
    await screen.findByRole("alert")
    expect(store.get(configAtom).translate.modelProviders.hover).toBeNull()
    expect(screen.getByRole("combobox", { name: "translationModels.hover" })).not.toBeDisabled()
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(config)
    chooseHover()
    await waitFor(() => expect(store.get(configAtom).translate.modelProviders.hover).toBe(second.id))
    await waitFor(async () => expect((await storage.getItem<typeof config>(`local:${CONFIG_STORAGE_KEY}`))?.translate.modelProviders.hover).toBe(second.id))
  })
})
