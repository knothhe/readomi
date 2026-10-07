// @vitest-environment jsdom
import type { PageSubtitleState } from "@/types/page-subtitle-state"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { configAtom } from "@/utils/atoms/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"
import { activeTabAtom } from "../atoms"
import { VideoTranslationControl } from "../components/video-translation-control"

const handlers = vi.hoisted(() => new Map<string, (message: { data: { tabId: number, state: PageSubtitleState } }) => void>())
vi.mock("@/utils/message", () => ({
  onMessage: (name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  },
  sendMessage: vi.fn(),
}))
const url = "https://www.youtube.com/watch?v=one"
const actual: PageSubtitleState = { url, enabled: true, available: true, overridden: true }
function mount(translatable = true) {
  const store = createStore()
  store.set(configAtom, DEFAULT_CONFIG)
  store.set(activeTabAtom, { id: 12, url: translatable ? url : "chrome://extensions/", translatable })
  const view = render(<Provider store={store}><VideoTranslationControl /></Provider>)
  return { ...view, store }
}
const toggle = () => screen.getByRole("switch", { name: "features.video" })
const broadcast = async (state: PageSubtitleState, tabId = 12) => act(() => handlers.get("pageSubtitleStateChanged")!({ data: { tabId, state } }))
beforeEach(() => {
  handlers.clear()
  vi.mocked(sendMessage).mockReset()
  vi.mocked(sendMessage).mockImplementation(async (type, data) => {
    if (type === "getPageSubtitleState")
      return actual
    if (type === "setPageSubtitleState")
      return { ...actual, enabled: (data as { enabled: boolean }).enabled }
  })
})
afterEach(cleanup)

describe("popup page subtitle switch", () => {
  it("reads actual page state rather than the default, reflects other controls and rereads on reopen", async () => {
    const view = mount()
    await waitFor(() => expect(toggle()).toBeChecked())
    expect(view.store.get(configAtom).features.videoSubtitles).toBe(false)
    await broadcast({ ...actual, enabled: false }, 99)
    expect(toggle()).toBeChecked()
    await broadcast({ ...actual, enabled: false })
    expect(toggle()).not.toBeChecked()
    view.unmount()
    vi.mocked(sendMessage).mockResolvedValue({ ...actual, enabled: false })
    mount()
    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).not.toBeChecked()
  })
  it("shares clicks and macOS Option+V without changing the global configuration", async () => {
    const { store } = mount()
    await waitFor(() => expect(toggle()).toBeEnabled())
    fireEvent.click(toggle())
    await waitFor(() => expect(toggle()).not.toBeChecked())
    expect(sendMessage).toHaveBeenCalledWith("setPageSubtitleState", { tabId: 12, url, enabled: false })
    fireEvent.keyDown(document, { key: "√", code: "KeyV", altKey: true })
    await waitFor(() => expect(toggle()).toBeChecked())
    expect(sendMessage).toHaveBeenCalledWith("setPageSubtitleState", { tabId: 12, url, enabled: true })
    expect(store.get(configAtom)).toEqual(DEFAULT_CONFIG)
  })
  it("disables while switching and preserves the previous state when switching fails", async () => {
    mount()
    await waitFor(() => expect(toggle()).toBeEnabled())
    let reject!: (error: Error) => void
    vi.mocked(sendMessage).mockImplementationOnce(() => new Promise((_, fail) => reject = fail))
    fireEvent.click(toggle())
    expect(toggle()).toBeDisabled()
    expect(toggle()).toBeChecked()
    await act(async () => reject(new Error("Extension context invalidated")))
    expect(toggle()).toBeEnabled()
    expect(toggle()).toBeChecked()
    expect(screen.getByRole("status")).toHaveTextContent("popup.subtitlePage.failed")
  })
  it("keeps a notification that arrives before an older initial read completes", async () => {
    let resolve!: (state: PageSubtitleState) => void
    vi.mocked(sendMessage).mockImplementationOnce(() => new Promise(done => resolve = done))
    mount()
    expect(toggle()).toBeDisabled()
    await broadcast({ ...actual, enabled: false })
    await act(async () => resolve(actual))
    expect(toggle()).not.toBeChecked()
    expect(toggle()).toBeEnabled()
  })
  it("does not let an old write response replace a newer player notification", async () => {
    mount()
    await waitFor(() => expect(toggle()).toBeEnabled())
    let resolve!: (state: PageSubtitleState) => void
    vi.mocked(sendMessage).mockImplementationOnce(() => new Promise(done => resolve = done))
    fireEvent.click(toggle())
    await broadcast({ ...actual, enabled: false })
    await broadcast(actual)
    await act(async () => resolve({ ...actual, enabled: false }))
    expect(toggle()).toBeChecked()
  })
  it("leaves unsupported pages and editable fields alone", async () => {
    const view = mount()
    await waitFor(() => expect(toggle()).toBeEnabled())
    const input = document.createElement("input")
    document.body.append(input)
    fireEvent.keyDown(input, { key: "v", code: "KeyV", altKey: true })
    expect(sendMessage).not.toHaveBeenCalledWith("setPageSubtitleState", expect.anything())
    input.remove()
    view.unmount()
    mount(false)
    expect(toggle()).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent("popup.subtitlePage.unavailable")
  })
})
