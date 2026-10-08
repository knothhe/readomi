import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import { z } from "zod"
import { configSchema } from "@/types/config/config"
import { DEFAULT_BASE_URLS } from "@/types/config/provider"

export const SYNC_PREFIX = "readomi.sync.v1."
export const SYNC_MANIFEST_KEY = `${SYNC_PREFIX}manifest`
export const SYNC_QUOTA = 102400
const ITEM_QUOTA = 8192
const PUBLIC_PROVIDER_FIELDS = ["id", "name", "description", "enabled", "provider", "api", "noApiKey", "baseURL", "model", "temperature"] as const
export type SyncedProvider = Pick<ProviderConfig, typeof PUBLIC_PROVIDER_FIELDS[number]>
export type SyncedConfig = Omit<Config, "providersConfig"> & { providersConfig: SyncedProvider[] }

export class ConfigSyncError extends Error {
  constructor(public readonly reason: "quota" | "invalid" | "changed") {
    super(`Configuration sync ${reason}`)
  }
}

export function publicProvider(provider: ProviderConfig): SyncedProvider {
  const result = Object.fromEntries(PUBLIC_PROVIDER_FIELDS.filter(key => provider[key] !== undefined).map(key => [key, provider[key]])) as SyncedProvider
  // Endpoint credentials must never become part of public service metadata.
  if (result.baseURL !== undefined)
    result.baseURL = result.baseURL.trim() || undefined
  if (result.baseURL) {
    let url: URL
    try {
      url = new URL(result.baseURL)
    }
    catch { throw new ConfigSyncError("invalid") }
    if (url.username || url.password || url.search || url.hash)
      throw new ConfigSyncError("invalid")
  }
  return result
}

/** Build an allowlisted payload. Newly added provider fields stay local by default. */
export function toSyncedConfig(config: Config): SyncedConfig {
  const validated = configSchema.parse(config)
  return { ...validated, providersConfig: validated.providersConfig.map(publicProvider) }
}

export function parseSyncedConfig(value: unknown): SyncedConfig {
  const parsed = configSchema.safeParse(value)
  if (!parsed.success || !value || typeof value !== "object")
    throw new ConfigSyncError("invalid")
  const providers = (value as Record<string, unknown>).providersConfig
  if (!Array.isArray(providers) || providers.some(provider => !provider || typeof provider !== "object" || Object.keys(provider).some(key => !(PUBLIC_PROVIDER_FIELDS as readonly string[]).includes(key))))
    throw new ConfigSyncError("invalid")
  if (hasUnknownFields(value, parsed.data))
    throw new ConfigSyncError("invalid")
  return toSyncedConfig(parsed.data)
}

function hasUnknownFields(input: unknown, parsed: unknown): boolean {
  if (!input || typeof input !== "object")
    return false
  if (!parsed || typeof parsed !== "object")
    return true
  return Object.entries(input).some(([key, value]) => !Object.hasOwn(parsed, key) || hasUnknownFields(value, (parsed as Record<string, unknown>)[key]))
}

function endpoint(provider: SyncedProvider): string | undefined {
  const base = provider.baseURL?.trim() || (provider.provider === "openai-compatible" ? undefined : DEFAULT_BASE_URLS[provider.provider])
  if (!base)
    return undefined
  try {
    return new URL(base).href.replace(/\/+$/, "")
  }
  catch { return undefined }
}

export function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, next) => next && typeof next === "object" && !Array.isArray(next)
    ? Object.fromEntries(Object.keys(next).sort().map(key => [key, next[key]]))
    : next)
}

export function sameSyncValue(a: unknown, b: unknown): boolean {
  return stableJSON(a) === stableJSON(b)
}

/** A key belongs to this service and endpoint, never to a newly received address. */
export function applySyncedConfig(local: Config, remote: SyncedConfig): Config {
  const providersConfig = remote.providersConfig.map((provider) => {
    const previous = local.providersConfig.find(p => p.id === provider.id && p.provider === provider.provider && endpoint(p) === endpoint(provider))
    if (!previous)
      return provider
    return {
      ...provider,
      ...(!provider.noApiKey && previous.apiKey !== undefined && { apiKey: previous.apiKey }),
      ...(previous.headers !== undefined && { headers: previous.headers }),
      ...(previous.body !== undefined && { body: previous.body }),
      ...(sameSyncValue(publicProvider(previous), provider) && previous.connectionCheck && { connectionCheck: previous.connectionCheck }),
    }
  })
  return configSchema.parse({ ...remote, providersConfig })
}

function mergeValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (sameSyncValue(local, base))
    return remote
  if (sameSyncValue(remote, base) || sameSyncValue(local, remote))
    return local
  if ([base, local, remote].every(value => value && typeof value === "object" && !Array.isArray(value))) {
    const b = base as Record<string, unknown>
    const l = local as Record<string, unknown>
    const r = remote as Record<string, unknown>
    return Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])].map(key => [key, mergeValue(b[key], l[key], r[key])]))
  }
  // Unsaved local edits win a simultaneous edit to the same field. Arrays are atomic.
  return local
}

/** Rebase pending edits while keeping provider selection and shortcuts consistent. */
export function mergeSyncedConfig(base: SyncedConfig, local: SyncedConfig, remote: SyncedConfig): SyncedConfig {
  const next = structuredClone(mergeValue(base, local, remote)) as SyncedConfig
  const services = (c: SyncedConfig) => ({ providersConfig: c.providersConfig, providerId: c.translate.providerId })
  const chosenServices = sameSyncValue(services(local), services(base)) ? services(remote) : services(local)
  next.providersConfig = chosenServices.providersConfig
  next.translate.providerId = chosenServices.providerId
  const shortcuts = (c: SyncedConfig) => [c.translate.page.shortcut, c.features.modeShortcut, c.features.subtitlesShortcut]
  const chosenShortcuts = sameSyncValue(shortcuts(local), shortcuts(base)) ? shortcuts(remote) : shortcuts(local)
  ;[next.translate.page.shortcut, next.features.modeShortcut, next.features.subtitlesShortcut] = chosenShortcuts
  return parseSyncedConfig(next)
}

const manifestSchema = z.strictObject({ version: z.literal(1), revision: z.string().uuid(), hash: z.string().regex(/^[\da-f]{64}$/), chunks: z.number().int().min(1).max(32) })
const documentSchema = z.strictObject({ version: z.literal(1), config: z.unknown() })
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("")
}

export interface RemoteSyncConfig { revision: string, config: SyncedConfig }

/** All chunks and the commit marker are written in one set(). Hash verification tolerates out-of-order delivery. */
export async function encodeSyncConfig(config: SyncedConfig, existing: Record<string, unknown>): Promise<{ revision: string, values: Record<string, unknown> }> {
  const text = stableJSON({ version: 1, config: parseSyncedConfig(config) })
  if (bytes(text) > SYNC_QUOTA)
    throw new ConfigSyncError("quota")
  const chunks: string[] = []
  let chunk = ""
  let size = 2
  for (const char of text) {
    const length = bytes(char) - 2
    if (size + length > 7800) {
      chunks.push(chunk)
      chunk = ""
      size = 2
    }
    chunk += char
    size += length
  }
  if (chunk)
    chunks.push(chunk)
  const revision = crypto.randomUUID()
  const values: Record<string, unknown> = { [SYNC_MANIFEST_KEY]: { version: 1, revision, hash: await digest(text), chunks: chunks.length } }
  chunks.forEach((value, index) => {
    values[`${SYNC_PREFIX}${index}`] = value
  })
  // Null old slots in the same atomic write instead of deleting the old snapshot first.
  for (const key of Object.keys(existing)) {
    if (key.startsWith(SYNC_PREFIX) && !(key in values))
      values[key] = null
  }
  const merged = { ...existing, ...values }
  if (Object.entries(merged).some(([key, value]) => new TextEncoder().encode(key).length + bytes(value) > ITEM_QUOTA)
    || Object.entries(merged).reduce((total, [key, value]) => total + new TextEncoder().encode(key).length + bytes(value), 0) > SYNC_QUOTA
    || Object.keys(merged).length > 512) {
    throw new ConfigSyncError("quota")
  }
  return { revision, values }
}

export async function decodeSyncConfig(values: Record<string, unknown>): Promise<RemoteSyncConfig | null> {
  if (values[SYNC_MANIFEST_KEY] == null) {
    if (Object.entries(values).some(([key, value]) => key.startsWith(SYNC_PREFIX) && value != null))
      throw new ConfigSyncError("invalid")
    return null
  }
  const manifest = manifestSchema.safeParse(values[SYNC_MANIFEST_KEY])
  if (!manifest.success)
    throw new ConfigSyncError("invalid")
  let text = ""
  for (let i = 0;
    i < manifest.data.chunks;
    i++) {
    const chunk = values[`${SYNC_PREFIX}${i}`]
    if (typeof chunk !== "string" || bytes(chunk) > ITEM_QUOTA)
      throw new ConfigSyncError("invalid")
    text += chunk
  }
  if (bytes(text) > SYNC_QUOTA || await digest(text) !== manifest.data.hash)
    throw new ConfigSyncError("invalid")
  let document: z.infer<typeof documentSchema>
  try {
    document = documentSchema.parse(JSON.parse(text))
  }
  catch { throw new ConfigSyncError("invalid") }
  return { revision: manifest.data.revision, config: parseSyncedConfig(document.config) }
}
