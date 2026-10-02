import { z } from "zod"

import { langCodeISO6393Schema, langLevel } from "@/definitions"
import { COLOR_THEMES, DEFAULT_COLOR_THEME } from "@/utils/color-theme"
import { FEATURE_PROVIDER_DEFS } from "@/utils/constants/feature-providers"
import { normalizePageTranslationShortcut } from "@/utils/page-translation-shortcut"
import { THEME_MODES } from "@/utils/theme"
import { providersConfigSchema } from "./provider"
import { DEFAULT_SUBTITLE_STYLE, subtitleStyleSchema } from "./subtitle-style"
import { pageTranslationShortcutSchema, translateConfigSchema } from "./translate"

// Language schema
const languageSchema = z.object({
  sourceCode: langCodeISO6393Schema.or(z.literal("auto")),
  targetCode: langCodeISO6393Schema,
  level: langLevel,
})

// Complete config schema
export const configSchema = z.object({
  language: languageSchema,
  appearance: z.object({ colorTheme: z.enum(COLOR_THEMES).default(DEFAULT_COLOR_THEME), mode: z.enum(THEME_MODES).default("system") }),
  providersConfig: providersConfigSchema,
  reading: z.object({
    wordPrefixEmphasis: z.boolean().default(false),
  }),
  translate: translateConfigSchema,
  features: z.object({
    hoverTranslation: z.boolean().default(false),
    hoverHotkey: z.enum(["alt", "control", "shift", "backtick", "clickAndHold"]).default("alt"),
    modeShortcut: pageTranslationShortcutSchema.default(""),
    subtitlesShortcut: pageTranslationShortcutSchema.default(""),
    videoSubtitles: z.boolean().default(false),
    subtitleStyle: subtitleStyleSchema.default(DEFAULT_SUBTITLE_STYLE),
    subtitleMode: z.enum(["bilingual", "translationOnly"]).default("bilingual"),
  }),
}).superRefine((data, ctx) => {
  const shortcuts = [data.translate.page.shortcut, data.features.modeShortcut, data.features.subtitlesShortcut].filter(s => s.trim())
  for (const platform of ["mac", "windows"] as const) {
    const normalized = shortcuts.map(s => normalizePageTranslationShortcut(s, platform))
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({ code: "custom", message: "Translation shortcuts must use different key combinations.", path: ["features"] })
      break
    }
  }
  const providerIdsSet = new Set(data.providersConfig.map(p => p.id))

  for (const def of Object.values(FEATURE_PROVIDER_DEFS)) {
    const providerId = def.getProviderId(data)

    const validIds = new Set(providerIdsSet)
    if (!validIds.has(providerId)) {
      ctx.addIssue({
        code: "invalid_value",
        values: [...validIds],
        message: `Invalid provider id "${providerId}".`,
        path: [...def.configPath],
      })
      continue
    }

    const provider = data.providersConfig.find(p => p.id === providerId)
    if (provider && !def.isProvider(provider.provider)) {
      ctx.addIssue({
        code: "invalid_value",
        values: [...validIds],
        message: `Provider "${providerId}" is not a valid provider for this feature.`,
        path: [...def.configPath],
      })
    }

    if (provider && !provider.enabled) {
      ctx.addIssue({
        code: "custom",
        message: `Provider "${providerId}" must be enabled for this feature.`,
        path: [...def.configPath],
      })
    }
  }
})

export type Config = z.infer<typeof configSchema>
