import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { browserMock, updateDynamicRulesMock } = vi.hoisted(() => {
  const updateDynamicRulesMock = vi.fn<(options: unknown) => Promise<void>>()
  return {
    updateDynamicRulesMock,
    browserMock: {
      runtime: {
        id: "readomi-test-extension",
        getManifest: () => ({ version: "9.8.7" }),
      },
      declarativeNetRequest: { updateDynamicRules: updateDynamicRulesMock },
    },
  }
})

vi.mock("#imports", () => ({ browser: browserMock }))
vi.mock("wxt/browser", () => ({ browser: browserMock }))

const fetchMock = vi.fn<typeof fetch>()
const url = "https://service.example/v1/responses"

function deferredRegistration() {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

describe("provider fetch User-Agent", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("BROWSER", "chrome")
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response("ok"))
    updateDynamicRulesMock.mockReset()
    updateDynamicRulesMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("waits for the User-Agent rule before sending the first request", async () => {
    const registration = deferredRegistration()
    updateDynamicRulesMock.mockReturnValueOnce(registration.promise)
    const { fetchProvider } = await import("../fetch")
    const init = { method: "POST", body: "translation text" }

    const request = fetchProvider(url, init)
    expect(updateDynamicRulesMock).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()

    registration.resolve()
    await expect(request).resolves.toBeInstanceOf(Response)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, init)
  })

  it("shares initialization across concurrent and later requests", async () => {
    const registration = deferredRegistration()
    updateDynamicRulesMock.mockReturnValueOnce(registration.promise)
    const { fetchProvider } = await import("../fetch")

    const requests = [fetchProvider(url, {}), fetchProvider(`${url}?second`, {})]
    expect(updateDynamicRulesMock).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()

    registration.resolve()
    await Promise.all(requests)
    await fetchProvider(`${url}?third`, {})
    expect(updateDynamicRulesMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("retries failed initialization before a later request", async () => {
    const error = new Error("The network rule could not be installed")
    updateDynamicRulesMock.mockRejectedValueOnce(error)
    const { fetchProvider } = await import("../fetch")

    await expect(fetchProvider(url, {})).rejects.toBe(error)
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(fetchProvider(url, {})).resolves.toBeInstanceOf(Response)
    expect(updateDynamicRulesMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("does not send a request aborted while rule registration is pending", async () => {
    const registration = deferredRegistration()
    updateDynamicRulesMock.mockReturnValueOnce(registration.promise)
    const { fetchProvider } = await import("../fetch")
    const controller = new AbortController()

    const request = fetchProvider(url, { signal: controller.signal })
    const aborted = expect(request).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    registration.resolve()

    await aborted
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(["chrome", "edge"])("scopes %s network rules to this extension's HTTP API fetches", async (browser) => {
    vi.stubEnv("BROWSER", browser)
    const { fetchProvider } = await import("../fetch")

    await fetchProvider(url, {})

    expect(updateDynamicRulesMock).toHaveBeenCalledExactlyOnceWith({
      removeRuleIds: [1],
      addRules: [{
        id: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "user-agent", operation: "set", value: "Readomi/9.8.7" }],
        },
        condition: {
          initiatorDomains: [browserMock.runtime.id],
          resourceTypes: ["xmlhttprequest"],
          regexFilter: "^https?://",
        },
      }],
    })
  })

  it("sends Firefox requests directly without installing a network rule", async () => {
    vi.stubEnv("BROWSER", "firefox")
    updateDynamicRulesMock.mockRejectedValue(new Error("This permission is not available"))
    const { fetchProvider } = await import("../fetch")
    const init = { headers: { "User-Agent": "Readomi/9.8.7" } }

    await expect(fetchProvider(url, init)).resolves.toBeInstanceOf(Response)

    expect(updateDynamicRulesMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, init)
  })
})
