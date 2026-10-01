import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { exportConfigBackup, parseConfigBackup } from "../backup"

const configured = { ...DEFAULT_CONFIG, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "sk-backup", headers: { Authorization: "secret" }, connectionCheck: { ok: true, checkedAt: 1 } })) }

describe("local configuration backups", () => {
  it("exports Readomi themes and accepts earlier backups from this fork", () => {
    const config = { ...configured, appearance: { colorTheme: "plum" as const } }
    const text = exportConfigBackup(config)
    expect(JSON.parse(text).format).toBe("readomi-config")
    expect(parseConfigBackup(text).appearance).toEqual(config.appearance)
    const { appearance: _, ...old } = configured
    const imported = parseConfigBackup(JSON.stringify({ format: "reading-config", config: { ...old, version: 3 } }))
    expect(imported.appearance.colorTheme).toBe("terra")
    expect(imported.providersConfig[0].apiKey).toBe("sk-backup")
  })
  it("round trips new shortcuts and rejects two actions sharing a key combination", () => {
    const next = { ...configured, features: { ...configured.features, hoverHotkey: "shift" as const, modeShortcut: "Alt+M", subtitlesShortcut: "Alt+V" } }
    expect(parseConfigBackup(exportConfigBackup(next)).features).toEqual(next.features)
    expect(() => parseConfigBackup(JSON.stringify({ format: "reading-config", config: { ...next, features: { ...next.features, modeShortcut: configured.translate.page.shortcut } } }))).toThrow("different key combinations")
  })
  it("round trips secrets, features and prompts while clearing old connection checks", () => {
    const backup = parseConfigBackup(exportConfigBackup(configured))
    expect(backup.providersConfig[0].apiKey).toBe("sk-backup")
    expect(backup.providersConfig[0].headers).toEqual({ Authorization: "secret" })
    expect(backup.providersConfig[0].connectionCheck).toBeUndefined()
    expect(backup.features).toEqual(DEFAULT_CONFIG.features)
    expect(backup.translate).toEqual(DEFAULT_CONFIG.translate)
  })
  it("migrates version 1 without losing the API key", () => {
    const { features: _, ...old } = configured
    const result = parseConfigBackup(JSON.stringify({ format: "reading-config", config: { ...old, version: 1 } }))
    expect(result.providersConfig[0].apiKey).toBe("sk-backup")
    expect(result.features).toEqual(DEFAULT_CONFIG.features)
    expect(result.version).toBe(DEFAULT_CONFIG.version)
  })
  it("rejects foreign, malformed and future configurations", () => {
    expect(() => parseConfigBackup("{")).toThrow()
    expect(() => parseConfigBackup(JSON.stringify(DEFAULT_CONFIG))).toThrow("Unsupported")
    expect(() => parseConfigBackup(JSON.stringify({ format: "reading-config", config: { ...DEFAULT_CONFIG, version: 99 } }))).toThrow("newer")
    expect(() => parseConfigBackup(JSON.stringify({ format: "reading-config", config: { ...DEFAULT_CONFIG, providersConfig: [] } }))).toThrow("Invalid provider")
  })
})
