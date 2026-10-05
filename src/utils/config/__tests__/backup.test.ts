import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { exportConfigBackup, MAX_BACKUP_SIZE, parseConfigBackup } from "../backup"

const configured = { ...DEFAULT_CONFIG, providersConfig: DEFAULT_CONFIG.providersConfig.map(p => ({ ...p, apiKey: "sk-backup", headers: { Authorization: "secret" }, connectionCheck: { ok: true, checkedAt: 1 } })) }

describe("local configuration backups", () => {
  it("preserves explicitly hidden video controls through a backup round trip", () => {
    const config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoControls: false } }
    expect(parseConfigBackup(exportConfigBackup(config))).toEqual(config)
  })

  it("round trips custom CSS without rewriting it", () => {
    const config = {
      ...configured,
      translate: {
        ...configured.translate,
        translationNodeStyle: { preset: "line" as const, isCustom: true, customCSS: "[data-readomi-custom-translation-style='custom'] { color: var(--readomi-brand); }" },
      },
    }
    const imported = parseConfigBackup(exportConfigBackup(config))
    expect(imported.translate.translationNodeStyle).toEqual(config.translate.translationNodeStyle)
  })

  it("exports Readomi backups and preserves the selected theme", () => {
    const config = { ...configured, appearance: { ...DEFAULT_CONFIG.appearance, colorTheme: "plum" as const } }
    const text = exportConfigBackup(config)
    expect(JSON.parse(text).format).toBe("readomi-config")
    expect(parseConfigBackup(text).appearance).toEqual(config.appearance)
  })

  it("round trips shortcuts and rejects two actions sharing a key combination", () => {
    const next = { ...configured, features: { ...configured.features, hoverHotkey: "shift" as const, modeShortcut: "Alt+M", subtitlesShortcut: "Alt+V" } }
    expect(parseConfigBackup(exportConfigBackup(next)).features).toEqual(next.features)
    expect(() => parseConfigBackup(JSON.stringify({ format: "readomi-config", config: { ...next, features: { ...next.features, modeShortcut: configured.translate.page.shortcut } } }))).toThrow("different key combinations")
  })

  it("round trips secrets, features and prompts while clearing connection checks", () => {
    const backup = parseConfigBackup(exportConfigBackup(configured))
    expect(backup.providersConfig[0].apiKey).toBe("sk-backup")
    expect(backup.providersConfig[0].headers).toEqual({ Authorization: "secret" })
    expect(backup.providersConfig[0].connectionCheck).toBeUndefined()
    expect(backup.features).toEqual(DEFAULT_CONFIG.features)
    expect(backup.translate).toEqual(DEFAULT_CONFIG.translate)
  })

  it("rejects foreign, malformed, incomplete and oversized configurations", () => {
    expect(() => parseConfigBackup("{")).toThrow()
    expect(() => parseConfigBackup(JSON.stringify(DEFAULT_CONFIG))).toThrow("Unsupported")
    expect(() => parseConfigBackup(JSON.stringify({ format: "other-config", config: DEFAULT_CONFIG }))).toThrow("Unsupported")
    expect(() => parseConfigBackup(JSON.stringify({ format: "readomi-config", config: { ...DEFAULT_CONFIG, providersConfig: [] } }))).toThrow("Invalid provider")
    const { features: _, ...incomplete } = configured
    expect(() => parseConfigBackup(JSON.stringify({ format: "readomi-config", config: incomplete }))).toThrow("features")
    expect(() => parseConfigBackup(" ".repeat(MAX_BACKUP_SIZE + 1))).toThrow("exceeds 1 MB")
  })
})
