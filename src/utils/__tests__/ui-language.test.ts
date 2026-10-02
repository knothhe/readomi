import { afterEach, describe, expect, it, vi } from "vitest"
import { browser, i18n } from "#imports"
import { configSchema } from "@/types/config/config"
import { exportConfigBackup, parseConfigBackup } from "@/utils/config/backup"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { formatUIMessage, getUILocale, setUILanguage } from "../ui-language"
import { UI_LANGUAGES } from "../ui-language-options"

const runtimeId = Object.getOwnPropertyDescriptor(browser.runtime, "id")!
const browserI18n = Object.getOwnPropertyDescriptor(browser, "i18n")!

afterEach(() => {
  Object.defineProperty(browser.runtime, "id", runtimeId)
  Object.defineProperty(browser, "i18n", browserI18n)
  vi.restoreAllMocks()
  setUILanguage("browser")
})

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

  it("uses bundled messages for a render finishing after Chrome removes the extension APIs", () => {
    vi.spyOn(browser.i18n, "getUILanguage").mockReturnValue("zh-CN")
    expect(getUILocale()).toBe("zh-CN")
    Object.defineProperty(browser.runtime, "id", { configurable: true, value: undefined })
    Object.defineProperty(browser, "i18n", { configurable: true, value: undefined })
    expect(i18n.t("options.title")).toBe("设置")
    expect(i18n.t("options.service.sendsTo", ["example.com"])).toContain("example.com")
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
