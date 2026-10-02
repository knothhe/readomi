import { afterEach, describe, expect, it } from "vitest"
import { i18n } from "#imports"
import { configSchema } from "@/types/config/config"
import { exportConfigBackup, parseConfigBackup } from "@/utils/config/backup"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { formatUIMessage, getUILocale, setUILanguage } from "../ui-language"
import { UI_LANGUAGES } from "../ui-language-options"

afterEach(() => setUILanguage("browser"))

describe("interface language", () => {
  it.each(UI_LANGUAGES.filter(language => language !== "browser"))("uses the bundled %s messages and formats substitutions", (language) => {
    setUILanguage(language)
    expect(getUILocale()).toBe(language)
    expect(i18n.t("uiLanguage.title")).not.toBe("uiLanguage.title")
    expect(i18n.t("options.service.sendsTo", ["example.com"])).toContain("example.com")
    expect(i18n.t("options.service.sendsTo", ["example.com"])).not.toContain("$1")
  })

  it("returns to browser messages after a manual choice", () => {
    setUILanguage("zh-CN")
    expect(i18n.t("options.title")).toBe("设置")
    setUILanguage("browser")
    expect(i18n.t("options.title")).toBe("options.title")
  })

  it("formats named placeholders without reinterpreting dollar signs in substitutions", () => {
    expect(formatUIMessage({ message: "$site$: $2 / $$", placeholders: { site: { content: "$1" } } }, ["$2.example.com", 12])).toBe("$2.example.com: 12 / $")
  })

  it("keeps existing settings when upgrading an older configuration or importing a backup", () => {
    const { ui: _, ...older } = DEFAULT_CONFIG
    const updated = configSchema.parse(older)
    expect(updated).toEqual(DEFAULT_CONFIG)
    const chosen = { ...updated, ui: { language: "ja" as const } }
    expect(parseConfigBackup(exportConfigBackup(chosen)).ui.language).toBe("ja")
    expect(parseConfigBackup(JSON.stringify({ format: "readomi-config", config: older })).ui.language).toBe("browser")
  })
})
