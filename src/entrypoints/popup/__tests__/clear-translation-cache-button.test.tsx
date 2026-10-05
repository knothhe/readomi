// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { sendMessage } from "@/utils/message"
import { activeTabAtom } from "../atoms"
import { ClearTranslationCacheButton } from "../components/clear-translation-cache-button"

vi.mock("@/utils/message", () => ({ sendMessage: vi.fn() }))

function show(translatable = true) {
  const store = createStore()
  store.set(activeTabAtom, { id: 7, url: "https://example.com/article", translatable })
  return render(<Provider store={store}><ClearTranslationCacheButton /></Provider>)
}

describe("clear current-page translation cache", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("targets only the captured page and confirms the icon action accessibly", async () => {
    vi.useFakeTimers()
    vi.mocked(sendMessage).mockResolvedValue(undefined)
    show()
    const button = screen.getByRole("button", { name: "popup.clearTranslationCache.label" })
    expect(button).toHaveAttribute("title", "popup.clearTranslationCache.description")
    expect(button.querySelector("svg")).not.toBeNull()
    expect(button.textContent).toBe("")
    await act(async () => fireEvent.click(button))
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith("clearPageTranslationCache", { tabId: 7, url: "https://example.com/article" })
    expect(button).toHaveAttribute("aria-label", "popup.clearTranslationCache.cleared")
    expect(button).toBeEnabled()
    await act(async () => vi.advanceTimersByTime(3000))
    expect(button).toHaveAttribute("aria-label", "popup.clearTranslationCache.label")
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("allows retrying a storage failure without exposing raw details", async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValueOnce(undefined)
    show()
    fireEvent.click(screen.getByRole("button", { name: "popup.clearTranslationCache.label" }))
    const failed = await screen.findByRole("button", { name: "popup.clearTranslationCache.failed" })
    expect(failed).toBeEnabled()
    expect(screen.queryByText("Storage unavailable")).toBeNull()
    fireEvent.click(failed)
    await screen.findByRole("button", { name: "popup.clearTranslationCache.cleared" })
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it("disables pending and unavailable-page actions", async () => {
    let finish!: () => void
    vi.mocked(sendMessage).mockImplementationOnce(() => new Promise<void>(resolve => finish = resolve))
    show()
    const button = screen.getByRole("button", { name: "popup.clearTranslationCache.label" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(sendMessage).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(button).toHaveAttribute("aria-label", "popup.clearTranslationCache.cleared"))
    cleanup()
    show(false)
    expect(screen.getByRole("button", { name: "popup.clearTranslationCache.label" })).toBeDisabled()
  })
})
