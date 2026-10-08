// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { detectBrowserEnvironment } from "@/utils/browser-environment"
import { SYNC_STATE_KEY } from "@/utils/config/sync-state"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"
import { checkConnection } from "@/utils/providers/test-connection"
import { ServiceSection } from "../service"
import { ChromeSync } from "./chrome-sync"

vi.mock("@/utils/browser-environment", () => ({ detectBrowserEnvironment: vi.fn() }))
vi.mock("@/utils/message", () => ({ sendMessage: vi.fn() }))
vi.mock("@/utils/providers/test-connection", () => ({ checkConnection: vi.fn() }))
const info = { environment: { name: "Google Chrome", supported: true }, status: { enabled: false, phase: "off" as const, savedAt: null } }

beforeEach(() => {
  fakeBrowser.reset()
  vi.clearAllMocks()
  vi.mocked(detectBrowserEnvironment).mockResolvedValue(info.environment)
  vi.mocked(sendMessage).mockImplementation(async (type) => {
    if (type === "inspectConfigSync")
      return { revision: "existing-snapshot" } as never
    return info as never
  })
})
afterEach(cleanup)

it("disables synchronization in Edge but leaves the backup panel independent", async () => {
  vi.mocked(detectBrowserEnvironment).mockResolvedValue({ name: "Microsoft Edge", supported: false })
  render(<ChromeSync onStatusChange={vi.fn()} />)
  await screen.findByText("configSync.unsupported")
  expect(screen.getByRole("switch")).toBeDisabled()
  expect(sendMessage).not.toHaveBeenCalled()
})
it("asks which existing configuration to use before enabling, without counts or extra descriptions", async () => {
  render(<ChromeSync onStatusChange={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled())
  fireEvent.click(screen.getByRole("switch"))
  const dialog = await screen.findByRole("dialog")
  expect(dialog).toHaveTextContent("configSync.useRemote")
  expect(dialog).toHaveTextContent("configSync.useLocal")
  expect(sendMessage).not.toHaveBeenCalledWith("setConfigSyncEnabled", expect.anything())
  fireEvent.click(screen.getByRole("radio", { name: "configSync.useLocal" }))
  fireEvent.click(screen.getByRole("button", { name: "configSync.enable" }))
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("setConfigSyncEnabled", { enabled: true, source: "local", revision: "existing-snapshot" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
})
it("starts from this device immediately when sync storage is empty", async () => {
  vi.mocked(sendMessage).mockImplementation(async type => type === "inspectConfigSync" ? { revision: null } as never : info as never)
  render(<ChromeSync onStatusChange={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled())
  fireEvent.click(screen.getByRole("switch"))
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("setConfigSyncEnabled", { enabled: true, source: "local", revision: null }))
  expect(screen.queryByRole("dialog")).toBeNull()
})
it("shows quota failures arriving from the background while preserving the enabled switch", async () => {
  render(<ChromeSync onStatusChange={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled())
  await storage.setItem(SYNC_STATE_KEY, { enabled: true, phase: "quota", savedAt: 1 })
  await screen.findByText("configSync.quota")
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true")
  expect(screen.getByRole("button", { name: "configSync.retry" })).toBeEnabled()
})

it("clears the missing-key warning after saving the synced service and keeps the key after reopening settings", async () => {
  const service = { ...DEFAULT_CONFIG.providersConfig[0], name: "Synced service", model: "synced-model", apiKey: undefined }
  const initial = { ...structuredClone(DEFAULT_CONFIG), providersConfig: [service] }
  await storage.setItem("local:config", initial)
  vi.mocked(sendMessage).mockResolvedValue({ ...info, status: { enabled: true, phase: "saved", savedAt: 1 } } as never)
  vi.mocked(checkConnection).mockResolvedValue({ ok: true, checkedAt: 2 })
  const store = createStore()
  store.set(configAtom, initial)
  const onStatusChange = vi.fn()
  const view = render(
    <Provider store={store}>
      <ServiceSection />
      <ChromeSync onStatusChange={onStatusChange} />
    </Provider>,
  )
  await screen.findByText("configSync.needsKeys")
  fireEvent.click(screen.getByLabelText("options.service.actions"))
  fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
  fireEvent.change(screen.getByLabelText("manualService.key"), { target: { value: "sk-new-local-key" } })
  fireEvent.click(screen.getByRole("button", { name: "options.service.checkSave" }))
  await screen.findByRole("heading", { name: "Synced service" })
  await waitFor(() => expect(screen.queryByText("configSync.needsKeys")).toBeNull())
  const saved = await storage.getItem<typeof initial>("local:config")
  expect(saved?.providersConfig).toHaveLength(1)
  expect(saved?.providersConfig[0]).toMatchObject({ id: service.id, apiKey: "sk-new-local-key" })
  view.unmount()
  const reopened = createStore()
  reopened.set(configAtom, saved!)
  render(
    <Provider store={reopened}>
      <ServiceSection />
      <ChromeSync onStatusChange={onStatusChange} />
    </Provider>,
  )
  await screen.findByText("configSync.saved")
  expect(screen.queryByText("configSync.needsKeys")).toBeNull()
  fireEvent.click(screen.getByLabelText("options.service.actions"))
  fireEvent.click(screen.getByRole("button", { name: "options.service.edit" }))
  expect(screen.getByLabelText("manualService.key")).toHaveAttribute("placeholder", "sk-…-key")
})
