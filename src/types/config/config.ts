import { z } from "zod"

import { langCodeISO6393Schema, langLevel } from "@/definitions"
import { FEATURE_PROVIDER_DEFS } from "@/utils/constants/feature-providers"
import { normalizePageTranslationShortcut } from "@/utils/page-translation-shortcut"
import { providersConfigSchema } from "./provider"
import { pageTranslationShortcutSchema, translateConfigSchema } from "./translate"

// Language schema
const languageSchema = z.object({
  sourceCode: langCodeISO6393Schema.or(z.literal("auto")),
  targetCode: langCodeISO6393Schema,
  level: langLevel,
})

/**
 * Version of the stored config shape. Bump it with every change to the
 * shape and add the step from the previous version to CONFIG_MIGRATIONS
 * (utils/config/migrate.ts); a stored config with no path to this version
 * is cleared.
 */
export const CONFIG_VERSION = 3

// Complete config schema
export const configSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  language: languageSchema,
  providersConfig: providersConfigSchema,
  // A stored config without this section gets the default of each field.
  reading: z.object({
    wordPrefixEmphasis: z.boolean().default(false),
  }).prefault({}),
  translate: translateConfigSchema,
  features: z.object({
    hoverTranslation: z.boolean().default(false),
    hoverHotkey: z.enum(["alt", "control", "shift", "backtick", "clickAndHold"]).default("alt"),
    modeShortcut: pageTranslationShortcutSchema.default(""),
    subtitlesShortcut: pageTranslationShortcutSchema.default(""),
    videoSubtitles: z.boolean().default(false),
    subtitleMode: z.enum(["bilingual", "translationOnly"]).default("bilingual"),
  }).prefault({}),
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
