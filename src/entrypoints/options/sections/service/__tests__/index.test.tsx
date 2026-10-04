// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { fetchProviderModels } from "@/utils/providers/models"
import { checkConnection } from "@/utils/providers/test-connection"
import { ServiceSection } from ".."

vi.mock("@/utils/providers/models", () => ({ fetchProviderModels: vi.fn() }))
vi.mock("@/utils/providers/test-connection", async importOriginal => ({
  ...await importOriginal<typeof import("@/utils/providers/test-connection")>(),
  checkConnection: vi.fn(),
}))

const configured: Config = {
  ...DEFAULT_CONFIG,
  providersConfig: DEFAULT_CONFIG.providersConfig.map(provider => ({
    ...provider,
    name: "My translation service",
    apiKey: "sk-abcdefghijkl",
    baseURL: "https://translation.example/v1",
    headers: { "X-Readomi": "fixture" },
    body: { reasoning: { effort: "none" } },
    temperature: 0,
    connectionCheck: { ok: true, checkedAt: 1_000 },
  })),
}

async function renderService(config: Config = configured) {
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  const view = render(<Provider store={store}><ServiceSection /></Provider>)
  return { ...view, store }
}

const editor = () => screen.getByRole("textbox", { name: "options.service.editorLabel" }) as HTMLTextAreaElement

describe("compact translation service settings", () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.mocked(checkConnection).mockReset().mockResolvedValue({ ok: true, checkedAt: 1_000 })
    vi.mocked(fetchProviderModels).mockReset().mockResolvedValue(["model-a"])
  })
  afterEach(cleanup)

  it("keeps the main card compact and expands full connection details without requests or saved changes", async () => {
    const { container, store } = await renderService()
    expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["options.service.test", "options.service.edit"])
    expect(screen.getByRole("heading", { name: "My translation service" })).toBeVisible()
    expect(screen.getByTestId("service-status")).toHaveTextContent("options.service.status.ok")
    expect(screen.queryByRole("group", { name: "options.service.configMethod" })).toBeNull()
    expect(screen.queryByLabelText("options.service.editorLabel")).toBeNull()
    const details = container.querySelector<HTMLDetailsElement>(".settings-service-details")!
    expect(details.open).toBe(false)
    expect(screen.getByText("https://translation.example/v1")).not.toBeVisible()
    expect(container).not.toHaveTextContent("sk-abcdefghijkl")

    fireEvent.click(screen.getByText("options.service.connectionDetails"))
    expect(details.open).toBe(true)
    expect(screen.getByText("https://translation.example/v1")).toBeVisible()
    expect(within(details).getByText("options.service.headers")).toBeVisible()
    expect(within(details).getByText(/"X-Readomi": "fixture"/)).toBeVisible()
    expect(within(details).getByText(/"reasoning"/)).toBeVisible()
    expect(within(details).getByText("0")).toBeVisible()
    expect(within(details).getByText(configured.translate.providerId)).toBeVisible()
    expect(within(details).getByText("sk-…ijkl")).toBeVisible()
    expect(checkConnection).not.toHaveBeenCalled()
    expect(fetchProviderModels).not.toHaveBeenCalled()
    expect(store.get(configAtom)).toEqual(configured)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(configured)
  })

  it("opens both configuration methods inside the same card and cancels their drafts without saving", async () => {
    const { container, store } = await renderService()
    const card = container.querySelector(".settings-service-card")
    fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
    expect(screen.getByRole("group", { name: "options.service.configMethod" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "My translation service" })).toBeVisible()
    expect(JSON.parse(editor().value)).toMatchObject({ apiKey: "sk-…ijkl", headers: { "X-Readomi": "fixture" }, temperature: 0 })
    expect(editor().selectionStart).toBe(0)
    expect(editor().selectionEnd).toBe(editor().value.length)
    expect(screen.getByRole("button", { name: "options.service.copyInstructions" })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "manualService.manual" }))
    expect(screen.getByLabelText("manualService.name")).toHaveValue("My translation service")
    fireEvent.change(screen.getByLabelText("manualService.name"), { target: { value: "Unsaved name" } })
    fireEvent.change(screen.getByLabelText("manualService.model"), { target: { value: "unsaved-model" } })
    fireEvent.change(screen.getByLabelText("manualService.key"), { target: { value: "unsaved-key" } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.cancel" }))
    expect(container.querySelector(".settings-service-card")).toBe(card)
    expect(screen.queryByRole("group", { name: "options.service.configMethod" })).toBeNull()
    expect(screen.queryByLabelText("manualService.model")).toBeNull()
    expect(store.get(configAtom)).toEqual(configured)

    fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
    fireEvent.change(editor(), { target: { value: JSON.stringify({ ...JSON.parse(editor().value), model: "unsaved-agent-model" }) } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.cancel" }))
    expect(screen.queryByLabelText("options.service.editorLabel")).toBeNull()
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(configured)
    expect(checkConnection).not.toHaveBeenCalled()
    expect(fetchProviderModels).not.toHaveBeenCalled()
  })

  it("starts unconfigured services directly in agent setup and keeps manual setup available", async () => {
    await renderService(DEFAULT_CONFIG)
    expect(screen.getByText("options.service.empty.title")).toBeVisible()
    expect(editor()).toHaveValue("")
    expect(screen.queryByTestId("service-status")).toBeNull()
    expect(screen.queryByRole("button", { name: "options.service.test" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "manualService.manual" }))
    expect(screen.getByLabelText("manualService.model")).toBeVisible()
    expect(screen.getByRole("button", { name: "modelDiscovery.fetch" })).toBeDisabled()
    expect(checkConnection).not.toHaveBeenCalled()
    expect(fetchProviderModels).not.toHaveBeenCalled()
  })

  it("tests only on request, shows pending and failed states and preserves every other setting", async () => {
    let finishCheck!: (value: Awaited<ReturnType<typeof checkConnection>>) => void
    vi.mocked(checkConnection).mockImplementation(() => new Promise(resolve => finishCheck = resolve))
    const { store } = await renderService()
    const test = screen.getByRole("button", { name: "options.service.test" })
    fireEvent.click(test)
    expect(test).toBeDisabled()
    expect(screen.getByRole("button", { name: "options.service.edit" })).toBeDisabled()
    expect(screen.getByTestId("service-status")).toHaveTextContent("options.service.testing")
    fireEvent.click(screen.getByText("options.service.connectionDetails"))
    expect(checkConnection).toHaveBeenCalledTimes(1)
    const result = { ok: false, checkedAt: 2_000, error: "HTTP 401: invalid key" }
    await act(async () => finishCheck(result))
    const expected: Config = { ...configured, providersConfig: configured.providersConfig.map(provider => provider.id === configured.translate.providerId ? { ...provider, connectionCheck: result } : provider) }
    await waitFor(async () => expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(expected))
    expect(store.get(configAtom)).toEqual(expected)
    expect(screen.getByTestId("service-status")).toHaveTextContent("options.service.status.failed")
    expect(screen.getByText(result.error)).toBeVisible()
    expect(test).toBeEnabled()
  })

  it("keeps the working service summary and agent draft when a replacement fails its connection check", async () => {
    vi.mocked(checkConnection).mockResolvedValue({ ok: false, checkedAt: 2_000, error: "Model unavailable" })
    const { store } = await renderService()
    fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
    const draft = JSON.stringify({ ...JSON.parse(editor().value), model: "unavailable-model" })
    fireEvent.change(editor(), { target: { value: draft } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.apply" }))
    expect(await screen.findByText("options.service.failedNotSaved")).toBeVisible()
    expect(screen.getByText("Model unavailable")).toBeVisible()
    expect(screen.getByRole("heading", { name: "My translation service" })).toBeVisible()
    expect(editor()).toHaveValue(draft)
    expect(store.get(configAtom)).toEqual(configured)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(configured)
  })
})
