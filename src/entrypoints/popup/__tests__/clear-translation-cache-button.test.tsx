// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { sendMessage } from "@/utils/message"
import { ClearTranslationCacheButton } from "../components/clear-translation-cache-button"

vi.mock("@/utils/message", () => ({ sendMessage: vi.fn() }))

describe("clear translation cache button", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("clears the global translation cache and briefly confirms success in place", async () => {
    vi.useFakeTimers()
    vi.mocked(sendMessage).mockResolvedValue(undefined)
    render(<ClearTranslationCacheButton />)
    const button = screen.getByRole("button", { name: "popup.clearTranslationCache.label" })
    expect(button).toHaveAttribute("title", "popup.clearTranslationCache.description")
    await act(async () => fireEvent.click(button))

    expect(sendMessage).toHaveBeenCalledExactlyOnceWith("clearTranslationCache")
    expect(button).toHaveTextContent("popup.clearTranslationCache.cleared")
    expect(button).toBeEnabled()
    await act(async () => vi.advanceTimersByTime(3000))
    expect(button).toHaveTextContent("popup.clearTranslationCache.label")
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("shows a recoverable failure and allows retrying from the same button", async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValueOnce(undefined)
    render(<ClearTranslationCacheButton />)
    fireEvent.click(screen.getByRole("button", { name: "popup.clearTranslationCache.label" }))
    const failed = await screen.findByRole("button", { name: "popup.clearTranslationCache.failed" })
    expect(failed).toBeEnabled()
    expect(screen.queryByText("Storage unavailable")).toBeNull()
    fireEvent.click(failed)

    await screen.findByRole("button", { name: "popup.clearTranslationCache.cleared" })
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it("disables the pending action and sends one request for repeated clicks", async () => {
    let finish!: () => void
    vi.mocked(sendMessage).mockImplementationOnce(() => new Promise<void>(resolve => finish = resolve))
    render(<ClearTranslationCacheButton />)
    const button = screen.getByRole("button", { name: "popup.clearTranslationCache.label" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toHaveTextContent("popup.clearTranslationCache.clearing")
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(sendMessage).toHaveBeenCalledTimes(1)

    finish()
    await waitFor(() => expect(button).toHaveTextContent("popup.clearTranslationCache.cleared"))
    expect(button).toBeEnabled()
  })
})
