import type { SyncedConfig } from "./sync-data"
import { z } from "zod"
import { storage } from "#imports"

export const SYNC_STATE_KEY = "local:readomi-config-sync" as const
export const syncStatusSchema = z.object({
  enabled: z.boolean(),
  phase: z.enum(["off", "pending", "saved", "failed", "quota"]),
  savedAt: z.number().nullable(),
})
export type ConfigSyncStatus = z.infer<typeof syncStatusSchema>
export interface StoredSyncState extends ConfigSyncStatus { baseline?: SyncedConfig, revision?: string }
export const DEFAULT_SYNC_STATUS: ConfigSyncStatus = { enabled: false, phase: "off", savedAt: null }
export async function readSyncState(): Promise<StoredSyncState> {
  const raw = await storage.getItem<StoredSyncState>(SYNC_STATE_KEY)
  const parsed = syncStatusSchema.safeParse(raw)
  return parsed.success ? { ...raw, ...parsed.data } : { ...DEFAULT_SYNC_STATUS }
}
