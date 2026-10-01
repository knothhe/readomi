import type { Config } from "@/types/config/config"
import { configSchema } from "@/types/config/config"

const FORMAT = "readomi-config"
export const MAX_BACKUP_SIZE = 1024 * 1024

export function exportConfigBackup(config: Config): string {
  return JSON.stringify({ format: FORMAT, config: configSchema.parse(config) }, null, 2)
}

export function parseConfigBackup(text: string): Config {
  if (text.length > MAX_BACKUP_SIZE)
    throw new Error("Configuration file exceeds 1 MB")
  const document = JSON.parse(text)
  if (!document || document.format !== FORMAT)
    throw new Error("Unsupported configuration file")
  const config = configSchema.parse(document.config)
  // Connection checks belong to this installation; a backup is not proof of connectivity.
  return { ...config, providersConfig: config.providersConfig.map(({ connectionCheck: _, ...provider }) => provider) }
}
