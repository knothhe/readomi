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
import { prepareRequest } from "@/utils/providers/request"
import { checkConnection } from "@/utils/providers/test-connection"
import { ServiceSection } from ".."

vi.mock("@/utils/providers/models", () => ({ fetchProviderModels: vi.fn() }))
vi.mock("@/utils/providers/test-connection", async importOriginal => ({
  ...await importOriginal<typeof import("@/utils/providers/test-connection")>(),
  checkConnection: vi.fn(),
}))

const first = { ...DEFAULT_CONFIG.providersConfig[0], name: "Service A", apiKey: "sk-abcdefghijkl", baseURL: "https://translation.example/v1", model: "model-a", connectionCheck: { ok: true, checkedAt: 1_000 } }
const second = { ...first, id: "second", name: "Service B", apiKey: "sk-second-key", model: "model-b" }
const configured: Config = { ...DEFAULT_CONFIG, providersConfig: [first, second], translate: { ...DEFAULT_CONFIG.translate, providerId: first.id } }

async function renderService(config: Config = configured) {
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  const view = render(<Provider store={store}><ServiceSection /></Provider>)
  return { ...view, store }
}
function editor() {
  if (!screen.queryByRole("textbox", { name: "options.service.editorLabel" }))
    fireEvent.click(screen.getByRole("button", { name: "manualService.agent" }))
  return screen.getByRole("textbox", { name: "options.service.editorLabel" }) as HTMLTextAreaElement
}
const row = (name: string) => screen.getByRole("heading", { name }).closest("article")!
function menu(name: string) {
  const serviceRow = row(name)
  fireEvent.click(within(serviceRow).getByLabelText("options.service.actions"))
  return within(serviceRow)
}
function edit(name: string) {
  fireEvent.click(within(row(name)).getByRole("button", { name: "options.service.editTitle" }))
}

describe("multiple translation services", () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.mocked(checkConnection).mockReset().mockResolvedValue({ ok: true, checkedAt: 2_000 })
    vi.mocked(fetchProviderModels).mockReset().mockResolvedValue(["model-a"])
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("previews keyboard sorting, cancels with Escape and preserves the current service", async () => {
    const { store } = await renderService()
    const handle = row("Service B").parentElement!.querySelector(".settings-service-drag-handle")!
    fireEvent.keyDown(handle, { key: " " })
    fireEvent.keyDown(handle, { key: "ArrowUp" })
    expect(screen.getAllByRole("heading", { level: 2 }).map(element => element.textContent)).toEqual(["Service B", "Service A"])
    expect(store.get(configAtom)).toEqual(configured)
    expect(screen.getByRole("status")).toHaveTextContent("options.service.order.moving")
    fireEvent.keyDown(handle, { key: "Escape" })
    expect(screen.getAllByRole("heading", { level: 2 }).map(element => element.textContent)).toEqual(["Service A", "Service B"])
    expect(screen.queryByRole("status")).toBeNull()
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(configured)
  })

  it("locks sorting during a pending save and quietly persists the order", async () => {
    const { store } = await renderService()
    const setItem = storage.setItem.bind(storage)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(storage, "setItem").mockImplementationOnce(async (...args) => {
      await gate
      return setItem(...args)
    })
    const handle = row("Service B").parentElement!.querySelector(".settings-service-drag-handle")!
    fireEvent.keyDown(handle, { key: " " })
    fireEvent.keyDown(handle, { key: "Home" })
    fireEvent.keyDown(handle, { key: " " })
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    for (const button of document.querySelectorAll(".settings-service-drag-handle"))
      expect(button).toBeDisabled()
    await act(async () => {
      release()
    })
    await waitFor(() => expect(handle).not.toBeDisabled())
    expect(store.get(configAtom).providersConfig).toEqual([second, first])
    expect(store.get(configAtom).translate.providerId).toBe(first.id)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual({ ...configured, providersConfig: [second, first] })
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(checkConnection).not.toHaveBeenCalled()
  })

  it("shows only a failed-sort prompt, restores order and retries the intended move", async () => {
    const { store } = await renderService()
    vi.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("Storage unavailable"))
    const handle = row("Service A").parentElement!.querySelector(".settings-service-drag-handle")!
    fireEvent.keyDown(handle, { key: " " })
    fireEvent.keyDown(handle, { key: "End" })
    fireEvent.keyDown(handle, { key: " " })
    expect(await screen.findByRole("alert")).toHaveTextContent("options.service.order.failed")
    expect(screen.getAllByRole("heading", { level: 2 }).map(element => element.textContent)).toEqual(["Service A", "Service B"])
    expect(store.get(configAtom)).toEqual(configured)
    fireEvent.click(screen.getByRole("button", { name: "options.service.order.retry" }))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.providersConfig).toEqual([second, first]))
    expect(store.get(configAtom).translate.providerId).toBe(first.id)
  })

  it("lists services without requests, marks current and prevents removing it", async () => {
    const { container, store } = await renderService()
    expect(screen.getByRole("heading", { name: "Service A" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Service B" })).toBeVisible()
    expect(within(row("Service A")).getByText("options.service.label.current")).toBeVisible()
    expect(screen.queryByLabelText("options.service.editorLabel")).toBeNull()
    expect(container).not.toHaveTextContent(first.apiKey)
    const actions = menu("Service A")
    expect(actions.getByRole("button", { name: "options.service.remove" })).toBeDisabled()
    expect(within(row("Service A")).getByRole("radio")).toHaveAttribute("aria-checked", "true")
    expect(checkConnection).not.toHaveBeenCalled()
    expect(store.get(configAtom)).toEqual(configured)
  })

  it("adds another account/model at the same endpoint without switching", async () => {
    const { store } = await renderService()
    fireEvent.click(screen.getByRole("button", { name: "options.service.add" }))
    expect(screen.getByRole("checkbox", { name: "options.service.useAfterAdd" })).not.toBeChecked()
    fireEvent.change(editor(), { target: { value: JSON.stringify({ type: first.provider, name: "Service C", apiKey: "new-key", baseURL: first.baseURL, model: "model-c" }) } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkAdd" }))
    await screen.findByRole("heading", { name: "Service C" })
    expect(store.get(configAtom).providersConfig).toHaveLength(3)
    expect(store.get(configAtom).translate.providerId).toBe(first.id)
    expect(store.get(configAtom).providersConfig.slice(0, 2)).toEqual(configured.providersConfig)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(store.get(configAtom))
  })

  it("can use the new service after a checked addition", async () => {
    const { store } = await renderService()
    fireEvent.click(screen.getByRole("button", { name: "options.service.add" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "options.service.useAfterAdd" }))
    fireEvent.change(editor(), { target: { value: JSON.stringify({ type: "deepseek", name: "Service C", apiKey: "key-c", model: "model-c" }) } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkAdd" }))
    await screen.findByRole("heading", { name: "Service C" })
    expect(store.get(configAtom).translate.providerId).toBe(store.get(configAtom).providersConfig[2].id)
  })

  it("edits the inactive service by ID with its own masked key and keeps selection", async () => {
    const { store } = await renderService()
    edit("Service B")
    expect(JSON.parse(editor().value)).toMatchObject({ model: "model-b", apiKey: "sk-…-key" })
    fireEvent.change(editor(), { target: { value: JSON.stringify({ ...JSON.parse(editor().value), model: "edited-model-b" }) } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    expect(checkConnection).toHaveBeenCalledWith(expect.objectContaining({ id: second.id, apiKey: second.apiKey, model: "edited-model-b" }))
    expect(store.get(configAtom).translate.providerId).toBe(first.id)
    expect(store.get(configAtom).providersConfig[0]).toEqual(first)
  })

  it("manual editing reuses only the targeted account and cancels unsaved changes", async () => {
    const { store } = await renderService()
    edit("Service B")
    fireEvent.click(screen.getByRole("button", { name: "manualService.manual" }))
    expect(screen.getByLabelText("manualService.name")).toHaveValue("Service B")
    fireEvent.change(screen.getByLabelText("manualService.model"), { target: { value: "manual-model-b" } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    expect(checkConnection).toHaveBeenCalledWith(expect.objectContaining({ id: second.id, apiKey: second.apiKey, model: "manual-model-b" }))
    const saved = store.get(configAtom)
    expect(saved.translate.providerId).toBe(first.id)
    edit("Service B")
    fireEvent.change(editor(), { target: { value: "invalid draft" } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.cancel" }))
    expect(store.get(configAtom)).toEqual(saved)
  })

  it("lists a synced service without a local key and fills the same service rather than adding a duplicate", async () => {
    const synced = { ...second, apiKey: undefined, connectionCheck: undefined }
    const { store } = await renderService({ ...configured, providersConfig: [first, synced] })
    expect(within(row("Service B")).getByRole("radio")).toBeDisabled()
    expect(within(row("Service B")).getByTestId("service-status")).toHaveTextContent("options.service.keyMissing")
    edit("Service B")
    const key = screen.getByLabelText("manualService.key")
    expect(key).toHaveValue("")
    fireEvent.change(key, { target: { value: "sk-filled-local-key" } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    const saved = store.get(configAtom)
    expect(saved.providersConfig).toHaveLength(2)
    expect(saved.providersConfig[1]).toMatchObject({ id: second.id, apiKey: "sk-filled-local-key" })
    expect(saved.translate.providerId).toBe(first.id)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(saved)
    edit("Service B")
    expect(screen.getByLabelText("manualService.key")).toHaveAttribute("placeholder", "manualService.savedKeyPlaceholder")
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    expect(store.get(configAtom).providersConfig[1].apiKey).toBe("sk-filled-local-key")
  })

  it("disables key entry, discovers models and saves a local service without a key", async () => {
    const local = { ...second, provider: "openai-compatible" as const, baseURL: "http://localhost:11434/v1", apiKey: "local" }
    const { store } = await renderService({ ...configured, providersConfig: [first, local] })
    edit("Service B")
    fireEvent.click(screen.getByRole("checkbox", { name: "manualService.noApiKey" }))
    expect(screen.getByLabelText("manualService.key")).toBeDisabled()
    expect(screen.getByLabelText("manualService.key")).toHaveValue("")
    expect(screen.getByLabelText("manualService.key")).not.toHaveAttribute("placeholder")
    fireEvent.click(screen.getByRole("button", { name: "modelDiscovery.fetch" }))
    await waitFor(() => expect(fetchProviderModels).toHaveBeenCalledWith(expect.objectContaining({ noApiKey: true, apiKey: undefined, baseURL: local.baseURL }), expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    expect(checkConnection).toHaveBeenCalledWith(expect.objectContaining({ noApiKey: true, baseURL: local.baseURL }))
    expect(vi.mocked(checkConnection).mock.calls[0][0]).not.toHaveProperty("apiKey")
    expect(store.get(configAtom).providersConfig[1]).not.toHaveProperty("apiKey")
    expect(within(row("Service B")).queryByTestId("service-status")).toBeNull()
    expect(within(row("Service B")).getByRole("radio")).toBeEnabled()
    edit("Service B")
    expect(screen.getByRole("checkbox", { name: "manualService.noApiKey" })).toBeChecked()
    fireEvent.click(screen.getByRole("checkbox", { name: "manualService.noApiKey" }))
    expect(screen.getByRole("button", { name: "options.service.checkSave" })).toBeDisabled()
  })

  it("shows a masked saved-key hint while keeping the editable password value empty", async () => {
    await renderService()
    edit("Service B")
    expect(screen.getByLabelText("manualService.key")).toHaveValue("")
    expect(screen.getByLabelText("manualService.key")).toHaveAttribute("placeholder", "manualService.savedKeyPlaceholder")
    expect(screen.getByLabelText("manualService.key")).not.toHaveAttribute("placeholder", second.apiKey)
  })

  it.each([
    { provider: "openai", api: "openai-responses", body: { reasoning: { effort: "high" }, max_output_tokens: 2000 } },
    { provider: "openai-compatible", api: "openai-chat", body: { reasoning_effort: "low", temperature: 0.2, stop: ["END"] } },
    { provider: "anthropic", api: "anthropic", body: { thinking: { type: "disabled" }, max_tokens: 4000 } },
    { provider: "gemini", api: "gemini", body: { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } } },
  ] as const)("edits, tests and persists custom parameters for $api", async ({ provider, api, body }) => {
    const service = { ...second, provider, api, temperature: 0.5 }
    const { store } = await renderService({ ...configured, providersConfig: [first, service] })
    edit("Service B")
    fireEvent.change(screen.getByLabelText("manualService.body"), { target: { value: JSON.stringify(body) } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    const saved = store.get(configAtom).providersConfig[1]
    expect(saved).toMatchObject({ body, api, apiKey: second.apiKey, temperature: 0.5 })
    expect(checkConnection).toHaveBeenCalledWith(expect.objectContaining({ body, api }))
    expect(prepareRequest(saved, { prompt: "Translate", temperature: saved.temperature }).body).toMatchObject(body)
    if (api === "gemini")
      expect(prepareRequest(saved, { prompt: "Translate", temperature: saved.temperature }).body.generationConfig).toMatchObject({ temperature: 0.5 })
    expect(store.get(configAtom).translate.providerId).toBe(first.id)
    expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.providersConfig[1].body).toEqual(body)
    edit("Service B")
    expect(screen.getByLabelText("manualService.body")).toHaveValue(JSON.stringify(body, null, 2))
  })

  it.each(["{", "[]", "null", "true", "123", "\"low\"", "{\"temperature\":1e400}"])("rejects invalid request parameters %s before testing or saving", async (value) => {
    const { store } = await renderService()
    edit("Service B")
    const input = screen.getByLabelText("manualService.body")
    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    expect(screen.getByRole("alert")).toHaveTextContent("manualService.bodyInvalid")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveFocus()
    expect(input).toHaveValue(value)
    expect(checkConnection).not.toHaveBeenCalled()
    expect(store.get(configAtom)).toEqual(configured)
    fireEvent.change(input, { target: { value: "{}" } })
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    expect(store.get(configAtom).providersConfig[1].body).toEqual({})
  })

  it("removes saved parameters when the field is cleared", async () => {
    const { store } = await renderService({ ...configured, providersConfig: [first, { ...second, body: { reasoning_effort: "low" } }] })
    edit("Service B")
    expect(screen.getByLabelText("manualService.body")).toHaveValue(JSON.stringify({ reasoning_effort: "low" }, null, 2))
    fireEvent.change(screen.getByLabelText("manualService.body"), { target: { value: "  \n " } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    expect(store.get(configAtom).providersConfig[1]).not.toHaveProperty("body")
    expect(vi.mocked(checkConnection).mock.calls[0][0]).not.toHaveProperty("body")
  })

  it("adds parameters to a new service and clears them when changing service type", async () => {
    const { store } = await renderService()
    fireEvent.click(screen.getByRole("button", { name: "options.service.add" }))
    const input = screen.getByLabelText("manualService.body")
    fireEvent.change(input, { target: { value: "{\"thinking\":{\"type\":\"disabled\"}}" } })
    fireEvent.click(screen.getByRole("combobox", { name: "manualService.type" }))
    fireEvent.click(screen.getByRole("option", { name: "OpenAI" }))
    expect(input).toHaveValue("")
    expect(input).toHaveAttribute("placeholder", JSON.stringify({ reasoning: { effort: "low" } }))
    fireEvent.change(screen.getByLabelText("manualService.key"), { target: { value: "new-key" } })
    fireEvent.change(screen.getByLabelText("manualService.model"), { target: { value: "model-c" } })
    fireEvent.change(input, { target: { value: "{\"reasoning\":{\"effort\":\"low\"}}" } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkAdd" }))
    await screen.findByRole("heading", { name: "OpenAI" })
    expect(store.get(configAtom).providersConfig[2]).toMatchObject({ provider: "openai", body: { reasoning: { effort: "low" } } })
    expect(store.get(configAtom).translate.providerId).toBe(first.id)
  })

  it("keeps custom parameter drafts and the saved service when the check fails", async () => {
    vi.mocked(checkConnection).mockResolvedValueOnce({ ok: false, checkedAt: 2_000, error: "Unsupported parameter" })
    const { store } = await renderService()
    edit("Service B")
    const value = "{\"reasoning_effort\":\"high\"}"
    fireEvent.change(screen.getByLabelText("manualService.body"), { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported parameter")
    expect(screen.getByLabelText("manualService.body")).toHaveValue(value)
    expect(store.get(configAtom)).toEqual(configured)
  })

  it("shows synced services arriving while the unconfigured settings page is open", async () => {
    const { store } = await renderService(DEFAULT_CONFIG)
    expect(screen.getByRole("button", { name: "options.service.checkAdd" })).toBeVisible()
    const synced = { ...configured, providersConfig: [{ ...first, apiKey: undefined, connectionCheck: undefined }] }
    await act(async () => {
      await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, synced)
      store.set(configAtom, synced)
    })
    expect(screen.getByRole("heading", { name: first.name })).toBeVisible()
    expect(screen.queryByRole("button", { name: "options.service.checkAdd" })).toBeNull()
  })

  it("keeps failed drafts without saving or switching, then permits a retry", async () => {
    vi.mocked(checkConnection).mockResolvedValueOnce({ ok: false, checkedAt: 2_000, error: "Model unavailable" })
    const { store } = await renderService()
    edit("Service B")
    const draft = JSON.stringify({ ...JSON.parse(editor().value), model: "unavailable-model" })
    fireEvent.change(editor(), { target: { value: draft } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    expect(await screen.findByText("options.service.failedNotSaved")).toBeVisible()
    expect(editor()).toHaveValue(draft)
    expect(store.get(configAtom)).toEqual(configured)
    expect(await storage.getItem(`local:${CONFIG_STORAGE_KEY}`)).toEqual(configured)
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
    await screen.findByRole("heading", { name: "Service B" })
    expect(store.get(configAtom).translate.providerId).toBe(first.id)
  })

  it("selects and removes services explicitly, and only tests on request", async () => {
    const { store } = await renderService()
    fireEvent.click(within(row("Service B")).getByRole("radio"))
    await waitFor(() => expect(store.get(configAtom).translate.providerId).toBe(second.id))
    await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.translate.providerId).toBe(second.id))
    expect(checkConnection).not.toHaveBeenCalled()
    fireEvent.click(menu("Service B").getByRole("button", { name: "options.service.test" }))
    await waitFor(() => expect(checkConnection).toHaveBeenCalledOnce())
    await act(async () => {})
    fireEvent.click(menu("Service A").getByRole("button", { name: "options.service.remove" }))
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Service A" })).toBeNull())
    expect(store.get(configAtom).providersConfig.map(provider => provider.id)).toEqual([second.id])
  })

  it("requires a new key when adding at an existing endpoint", async () => {
    const { store } = await renderService()
    fireEvent.click(screen.getByRole("button", { name: "options.service.add" }))
    fireEvent.change(editor(), { target: { value: JSON.stringify({ type: first.provider, baseURL: first.baseURL, model: "model-c", apiKey: "sk-…ijkl" }) } })
    expect(screen.getByRole("button", { name: "options.service.checkAdd" })).toBeDisabled()
    expect(screen.getByText("options.service.keyMissing")).toBeVisible()
    expect(checkConnection).not.toHaveBeenCalled()
    expect(store.get(configAtom)).toEqual(configured)
  })

  it("switches services with arrow keys without testing the connection", async () => {
    const { store } = await renderService()
    const firstRadio = within(row("Service A")).getByRole("radio")
    firstRadio.focus()
    fireEvent.keyDown(firstRadio, { key: "ArrowDown" })
    const secondRadio = within(row("Service B")).getByRole("radio")
    await waitFor(() => expect(secondRadio).toHaveAttribute("aria-checked", "true"))
    expect(secondRadio).toHaveFocus()
    expect(secondRadio).toHaveAttribute("tabindex", "0")
    expect(firstRadio).toHaveAttribute("tabindex", "-1")
    expect(store.get(configAtom).translate.providerId).toBe(second.id)
    expect(checkConnection).not.toHaveBeenCalled()
  })

  it("shows failures only after a test and retries with the latest saved service", async () => {
    vi.mocked(checkConnection).mockResolvedValueOnce({ ok: false, checkedAt: 2_000, error: "HTTP 401" })
    const { store } = await renderService({ ...configured, providersConfig: [first, { ...second, connectionCheck: { ok: false, checkedAt: 1, error: "Old error" } }] })
    expect(screen.queryByTestId("service-status")).toBeNull()
    expect(screen.queryByText("Old error")).toBeNull()
    fireEvent.click(menu("Service B").getByRole("button", { name: "options.service.test" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 401")
    await act(async () => {
      store.set(configAtom, { ...store.get(configAtom), providersConfig: [first, { ...second, apiKey: "updated-key" }] })
    })
    fireEvent.click(screen.getByRole("button", { name: "options.service.retryTest" }))
    await waitFor(() => expect(checkConnection).toHaveBeenLastCalledWith(expect.objectContaining({ id: second.id, apiKey: "updated-key" })))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("options.service.testPassed"))
    expect(screen.queryByTestId("service-status")).toBeNull()
  })

  it("returns to the list when another page removes the edited service", async () => {
    const { store } = await renderService()
    edit("Service B")
    await act(async () => {
      const removed = { ...configured, providersConfig: [first] }
      await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, removed)
      store.set(configAtom, removed)
    })
    await waitFor(() => expect(screen.queryByLabelText("options.service.editorLabel")).toBeNull())
    expect(screen.getByRole("button", { name: "options.service.add" })).toBeVisible()
    expect(screen.queryByRole("heading", { name: "Service B" })).toBeNull()
    expect(checkConnection).not.toHaveBeenCalled()
  })

  it("initial setup allows choosing the agent form and saves its first checked service", async () => {
    const { store } = await renderService(DEFAULT_CONFIG)
    expect(editor()).toHaveValue("")
    fireEvent.change(editor(), { target: { value: JSON.stringify({ type: "deepseek", name: "First", apiKey: "key", model: "model" }) } })
    fireEvent.click(screen.getByRole("button", { name: "options.service.checkAdd" }))
    await screen.findByRole("heading", { name: "First" })
    expect(store.get(configAtom).providersConfig).toHaveLength(1)
    expect(store.get(configAtom).providersConfig[0].id).toBe(store.get(configAtom).translate.providerId)
  })
})
