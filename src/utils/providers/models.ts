import type { ProviderConfig } from "@/types/config/provider"
import { fetchProvider } from "./fetch"
import { buildHeaders, resolveBaseURL, resolveRequestApi } from "./request"

export type ModelListProvider = Pick<ProviderConfig, "provider" | "api" | "apiKey" | "noApiKey" | "baseURL" | "headers">

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Fetch only from the reader's configured service, on explicit request. */
export async function fetchProviderModels(provider: ModelListProvider, signal?: AbortSignal): Promise<string[]> {
  const base = resolveBaseURL(provider)
  if (!base)
    throw new Error("Missing API address")
  const url = new URL(base)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Invalid API address")
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`
  url.hash = ""
  const api = resolveRequestApi(provider)
  const headers = buildHeaders(api, provider)
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  const models = new Set<string>()
  const cursors = new Set<string>()
  for (let page = 0; page < 20; page++) {
    const response = await fetchProvider(url, { method: "GET", headers, signal: requestSignal, redirect: "error" })
    if (!response.ok)
      throw new Error(`Model list request failed (${response.status})`)
    const json: unknown = await response.json()
    if (!isRecord(json))
      throw new Error("Invalid model list response")
    const entries = api === "gemini" ? json.models : json.data
    if (entries !== undefined && !Array.isArray(entries))
      throw new Error("Invalid model list response")
    if (entries === undefined && api !== "gemini")
      throw new Error("Invalid model list response")
    for (const entry of (entries ?? []) as unknown[]) {
      if (!isRecord(entry))
        continue
      if (api === "gemini" && (!Array.isArray(entry.supportedGenerationMethods) || !entry.supportedGenerationMethods.includes("generateContent")))
        continue
      const id = api === "gemini" ? entry.name : entry.id
      if (typeof id === "string" && id.trim())
        models.add(api === "gemini" ? id.trim().replace(/^models\//, "") : id.trim())
    }
    const next = api === "gemini" ? json.nextPageToken : api === "anthropic" && json.has_more === true ? json.last_id : undefined
    if (!next) {
      if (api === "anthropic" && json.has_more === true)
        throw new Error("Invalid model list cursor")
      return [...models].sort((a, b) => a.localeCompare(b))
    }
    if (typeof next !== "string" || cursors.has(next))
      throw new Error("Invalid model list cursor")
    cursors.add(next)
    url.searchParams.set(api === "gemini" ? "pageToken" : "after_id", next)
  }
  throw new Error("Model list pagination exceeded limit")
}
