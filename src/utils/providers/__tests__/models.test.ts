import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchProviderModels } from "../models"

const fetchMock = vi.fn<typeof fetch>()
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})
function respond(json: unknown) {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(json)))
}
describe("provider model discovery", () => {
  it("lists compatible models without requiring a configured model, preserving endpoint and headers", async () => {
    respond({ data: [{ id: "z-model" }, { id: "a-model" }, { id: "a-model" }, { id: " " }, {}] })
    const result = await fetchProviderModels({ provider: "openai-compatible", baseURL: "http://localhost:8000/v1/?tenant=me", apiKey: "local", headers: { "X-Tenant": "me" } })
    expect(result).toEqual(["a-model", "z-model"])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("http://localhost:8000/v1/models?tenant=me")
    expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { "authorization": "Bearer local", "x-tenant": "me" } })
  })
  it("uses Anthropic authentication and follows its cursor on the same endpoint", async () => {
    respond({ data: [{ id: "claude-a" }], has_more: true, last_id: "claude-a" })
    respond({ data: [{ id: "claude-b" }], has_more: false })
    expect(await fetchProviderModels({ provider: "anthropic", apiKey: "secret" })).toEqual(["claude-a", "claude-b"])
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "secret", "anthropic-version": "2023-06-01" })
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.anthropic.com/v1/models?after_id=claude-a")
  })
  it("filters Gemini to generation models and follows its page token", async () => {
    respond({ models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "next" })
    respond({ models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }] })
    expect(await fetchProviderModels({ provider: "gemini", apiKey: "secret" })).toEqual(["gemini-a", "gemini-b"])
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-goog-api-key": "secret" })
    expect(String(fetchMock.mock.calls[1][0])).toContain("pageToken=next")
  })
  it("uses the selected wire format for authentication", async () => {
    respond({ data: [{ id: "claude-custom" }] })
    await fetchProviderModels({ provider: "openai-compatible", api: "anthropic", baseURL: "https://relay.example/v1", apiKey: "secret" })
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "secret" })
  })
  it("handles an empty service without inventing suggested models", async () => {
    respond({ data: [] })
    expect(await fetchProviderModels({ provider: "openai" })).toEqual([])
  })
  it("rejects bad responses and HTTP errors", async () => {
    respond({ error: "not a list" })
    await expect(fetchProviderModels({ provider: "openai" })).rejects.toThrow("Invalid model list")
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }))
    await expect(fetchProviderModels({ provider: "openai" })).rejects.toThrow("401")
  })
  it("rejects repeated pagination cursors", async () => {
    respond({ data: [], has_more: true, last_id: "same" })
    respond({ data: [], has_more: true, last_id: "same" })
    await expect(fetchProviderModels({ provider: "anthropic" })).rejects.toThrow("cursor")
  })
  it("aborts requests and never sends a key to an invalid URL", async () => {
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    fetchMock.mockImplementation(async (_url, init) => {
      expect(init?.signal).toBeDefined()
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))
    })
    const pending = fetchProviderModels({ provider: "openai" }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    fetchMock.mockClear()
    await expect(fetchProviderModels({ provider: "openai-compatible", baseURL: "file:///tmp", apiKey: "secret" })).rejects.toThrow("Invalid API")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
