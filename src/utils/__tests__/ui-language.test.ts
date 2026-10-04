import { readFileSync } from "node:fs"
import { generateChromeMessages, parseMessagesText } from "@wxt-dev/i18n/build"
import { afterEach, describe, expect, it, vi } from "vitest"
import { browser, i18n } from "#imports"
import { configSchema } from "@/types/config/config"
import { exportConfigBackup, parseConfigBackup } from "@/utils/config/backup"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { formatUIMessage, getUILocale, setUILanguage } from "../ui-language"
import { UI_LANGUAGES } from "../ui-language-options"

vi.mock("#i18n", async () => {
  const { createI18n } = await import("@wxt-dev/i18n")
  return { i18n: createI18n() }
})

const runtimeId = Object.getOwnPropertyDescriptor(browser.runtime, "id")!
const browserI18n = Object.getOwnPropertyDescriptor(browser, "i18n")!
const translate = i18n.t as (key: string, ...args: Array<number | Array<string | number> | undefined>) => string

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

  it.each(UI_LANGUAGES.filter(language => language !== "browser"))("preserves every %s message and substitution after compilation", (language) => {
    const source = readFileSync(new URL(`../../locales/${language}.yml`, import.meta.url), "utf8")
    const messages = generateChromeMessages(parseMessagesText(source, "YAML"))
    const substitutions = ["$2.example.com", "12", "sample"]
    setUILanguage(language)
    for (const [key, entry] of Object.entries(messages))
      expect(translate(key, substitutions), `${language}.${key}`).toBe(formatUIMessage(entry, substitutions))
  })

  it("returns to browser messages after a manual choice", () => {
    setUILanguage("zh-CN")
    expect(i18n.t("options.title")).toBe("设置")
    setUILanguage("browser")
    expect(i18n.t("options.title")).toBe("options.title")
  })

  it("uses native messages when Chrome has the key", () => {
    const getMessage = vi.spyOn(browser.i18n, "getMessage").mockReturnValue("Native settings")
    expect(i18n.t("options.title")).toBe("Native settings")
    expect(getMessage).toHaveBeenCalledExactlyOnceWith("options_title")
  })

  it("uses bundled browser-locale messages when Chrome's loaded catalog lacks new keys", () => {
    vi.spyOn(browser.i18n, "getUILanguage").mockReturnValue("zh-CN")
    const getMessage = vi.spyOn(browser.i18n, "getMessage").mockReturnValue("")
    expect(i18n.t("siteRules.title")).toBe("站点规则")
    expect(i18n.t("siteRules.tabsLabel")).toBe("规则来源")
    expect(i18n.t("siteRules.emptyTitle")).toBe("还没有自定义规则")
    expect(i18n.t("siteRules.editorTitle")).toBe("编辑自定义规则")
    expect(i18n.t("siteRules.enabledCount", [482, 484])).toBe("已启用 482 / 484 条")
    expect(i18n.t("siteRules.showingCount", [50, 484])).toBe("显示 50 / 484 条")
    expect(i18n.t("siteRules.customCount", [2])).toBe("已保存 2 条规则")
    expect(getMessage).toHaveBeenCalledWith("siteRules_enabledCount", ["482", "484"])
  })

  it("falls back from a regional browser locale to its bundled language", () => {
    vi.spyOn(browser.i18n, "getUILanguage").mockReturnValue("en-US")
    vi.spyOn(browser.i18n, "getMessage").mockReturnValue("")
    expect(i18n.t("siteRules.title")).toBe("Site rules")
  })

  it("preserves native plural selection and substitutions", () => {
    const getMessage = vi.spyOn(browser.i18n, "getMessage").mockReturnValue("One native rule | Many native rules")
    expect(translate("siteRules.enabledCount", 2, [2, 484])).toBe("Many native rules")
    expect(getMessage).toHaveBeenCalledExactlyOnceWith("siteRules_enabledCount", ["2", "484"])
  })

  it("keeps browser system messages native even with an explicit interface language", () => {
    setUILanguage("zh-CN")
    const getMessage = vi.spyOn(browser.i18n, "getMessage").mockReturnValue("en-US")
    expect(translate("@@ui_locale")).toBe("en-US")
    getMessage.mockReturnValue("")
    expect(translate("@@unknown")).toBe("")
  })

  it("keeps missing unknown keys empty without repeating the native lookup", () => {
    const getMessage = vi.spyOn(browser.i18n, "getMessage").mockReturnValue("")
    expect(translate("unknown.key")).toBe("")
    expect(getMessage).toHaveBeenCalledExactlyOnceWith("unknown_key")
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

  it("uses bundled messages when a native lookup is invalidated before the runtime id disappears", () => {
    vi.spyOn(browser.i18n, "getUILanguage").mockReturnValue("zh-CN")
    vi.spyOn(browser.i18n, "getMessage").mockImplementation(() => {
      throw new Error("Extension context invalidated.")
    })
    expect(i18n.t("siteRules.title")).toBe("站点规则")
  })

  it("does not hide unrelated native translation errors", () => {
    const error = new Error("Unexpected catalog error")
    vi.spyOn(browser.i18n, "getMessage").mockImplementation(() => {
      throw error
    })
    expect(() => i18n.t("siteRules.title")).toThrow(error)
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
