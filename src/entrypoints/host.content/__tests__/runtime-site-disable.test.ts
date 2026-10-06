// @vitest-environment jsdom
import { waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { sendMessage } from "@/utils/message"
import { configWithMode, setUpHostContentTests, storeConfig } from "./host-content-harness"

const host = setUpHostContentTests()

function enabledConfig() {
  const config = configWithMode("bilingual")
  return { ...config, reading: { wordPrefixEmphasis: true } }
}

describe("website runtime disabling", () => {
  it("restores translated text and emphasis immediately, removes extension UI and resumes cleanly", async () => {
    const config = enabledConfig()
    const hostname = location.hostname
    await storeConfig(config)
    document.body.innerHTML = "<main><p>This article contains enough English words to translate and emphasize.</p></main>"
    await host.start()
    await waitFor(() => expect(document.querySelector("[data-readomi-host-toast]")).not.toBeNull())
    await waitFor(() => expect(document.body.textContent).toContain("translated:"))
    await storeConfig({ ...config, features: { ...config.features, disabledSites: [hostname] } })
    await waitFor(() => expect(document.querySelector("[data-readomi-host-toast]")).toBeNull())
    await waitFor(() => expect(document.body.textContent).not.toContain("translated:"))
    expect(document.body.textContent).toContain("This article contains")
    expect(host.stateMessages.at(-1)).toBe(false)
    await expect(sendMessage("askManagerToTogglePageTranslation", { enabled: true })).rejects.toThrow()
    await storeConfig(config)
    await waitFor(() => expect(document.querySelectorAll("[data-readomi-host-toast]")).toHaveLength(1))
    await waitFor(async () => {
      await sendMessage("askManagerToTogglePageTranslation", { enabled: true })
    })
    await waitFor(() => expect(document.body.textContent).toContain("translated:"))
    // A second disable/enable cycle must not leave duplicate observers or controls.
    await storeConfig({ ...config, features: { ...config.features, disabledSites: [hostname] } })
    await waitFor(() => expect(document.querySelector("[data-readomi-host-toast]")).toBeNull())
    await storeConfig(config)
    await waitFor(() => expect(document.querySelectorAll("[data-readomi-host-toast]")).toHaveLength(1))
  })

  it("leaves an initially disabled page untouched, even with remembered page translation", async () => {
    const config = enabledConfig()
    await storeConfig({ ...config, features: { ...config.features, disabledSites: [location.hostname] } })
    document.body.innerHTML = "<p>English text remains exactly as the website rendered it.</p>"
    const original = document.body.innerHTML
    await host.start()
    expect(document.body.innerHTML).toBe(original)
    expect(host.stateMessages).toEqual([])
    await expect(sendMessage("askManagerToTogglePageTranslation", { enabled: true })).rejects.toThrow()
    await storeConfig(config)
    await waitFor(() => expect(document.querySelector("[data-readomi-host-toast]")).not.toBeNull())
  })
})
