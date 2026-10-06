import { z } from "zod"

import { langCodeISO6393Schema, langLevel } from "@/definitions"
import { COLOR_THEMES, DEFAULT_COLOR_THEME } from "@/utils/color-theme"
import { FEATURE_PROVIDER_DEFS } from "@/utils/constants/feature-providers"
import { DEFAULT_MODE_SHORTCUT_KEY, DEFAULT_SUBTITLES_SHORTCUT_KEY } from "@/utils/constants/translate"
import { normalizePageTranslationShortcut } from "@/utils/page-translation-shortcut"
import { THEME_MODES } from "@/utils/theme"
import { UI_LANGUAGES } from "@/utils/ui-language-options"
import { providersConfigSchema } from "./provider"
import { siteRulesConfigSchema } from "./site-rules"
import { DEFAULT_SUBTITLE_STYLE, subtitleStyleSchema } from "./subtitle-style"
import { pageTranslationShortcutSchema, translateConfigSchema } from "./translate"
import { videoSiteRuleSchema } from "./video-site-rules"

// Language schema
const languageSchema = z.object({
  sourceCode: langCodeISO6393Schema.or(z.literal("auto")),
  targetCode: langCodeISO6393Schema,
  secondaryCode: langCodeISO6393Schema.or(z.literal("original")).default("eng"),
  level: langLevel,
})

/** A newly introduced shortcut must not invalidate an older action using that combination. */
function fillMissingShortcutDefaults(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return input
  const candidate = input as Record<string, unknown>
  if (typeof candidate.features !== "object" || candidate.features === null || Array.isArray(candidate.features))
    return input
  const features = candidate.features as Record<string, unknown>
  if (features.modeShortcut !== undefined && features.subtitlesShortcut !== undefined)
    return input
  const translate = candidate.translate as { page?: { shortcut?: unknown } } | undefined
  const occupied = [translate?.page?.shortcut, features.modeShortcut, features.subtitlesShortcut]
    .filter((value): value is string => typeof value === "string" && !!value.trim())
  const next = { ...features }
  const defaults = { modeShortcut: DEFAULT_MODE_SHORTCUT_KEY, subtitlesShortcut: DEFAULT_SUBTITLES_SHORTCUT_KEY }
  for (const [key, shortcut] of Object.entries(defaults)) {
    // Explicit empty strings mean the reader cleared the shortcut.
    if (features[key] !== undefined)
      continue
    const conflicts = occupied.some(assigned => ["mac", "windows"].some(platform => normalizePageTranslationShortcut(assigned, platform as "mac" | "windows") === normalizePageTranslationShortcut(shortcut, platform as "mac" | "windows")))
    next[key] = conflicts ? "" : shortcut
    if (!conflicts)
      occupied.push(shortcut)
  }
  return { ...candidate, features: next }
}

// Complete config schema
export const configSchema = z.preprocess(fillMissingShortcutDefaults, z.object({
  language: languageSchema,
  ui: z.object({ language: z.enum(UI_LANGUAGES).default("browser") }).default({ language: "browser" }),
  appearance: z.object({ colorTheme: z.enum(COLOR_THEMES).default(DEFAULT_COLOR_THEME), mode: z.enum(THEME_MODES).default("system") }),
  providersConfig: providersConfigSchema,
  reading: z.object({
    wordPrefixEmphasis: z.boolean().default(false),
  }),
  translate: translateConfigSchema,
  siteRules: siteRulesConfigSchema,
  features: z.object({
    disabledSites: z.array(z.string()).default([]),
    inputTranslation: z.boolean().default(true),
    hoverTranslation: z.boolean().default(false),
    hoverStream: z.boolean().default(true),
    hoverHotkey: z.enum(["alt", "control", "shift", "backtick", "clickAndHold"]).default("alt"),
    modeShortcut: pageTranslationShortcutSchema.default(DEFAULT_MODE_SHORTCUT_KEY),
    subtitlesShortcut: pageTranslationShortcutSchema.default(DEFAULT_SUBTITLES_SHORTCUT_KEY),
    videoSubtitles: z.boolean().default(false),
    videoControls: z.boolean().default(true),
    videoExcludedSites: z.array(videoSiteRuleSchema).default([]),
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
}))

export type Config = z.infer<typeof configSchema>
