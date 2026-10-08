import type { Config } from "@/types/config/config"
import { DEFAULT_SUBTITLE_STYLE } from "@/types/config/subtitle-style"
import { DEFAULT_TRANSLATE_PROMPTS_CONFIG } from "./prompt"
import { DEFAULT_PROVIDER_CONFIG_LIST } from "./providers"
import { DEFAULT_AUTO_TRANSLATE_SHORTCUT_KEY, DEFAULT_MODE_SHORTCUT_KEY, DEFAULT_SUBTITLES_SHORTCUT_KEY } from "./translate"
import { TRANSLATION_NODE_STYLE_ON_INSTALLED } from "./translation-node-style"

export const CONFIG_STORAGE_KEY = "config"

export const DEFAULT_CONFIG: Config = {
  ui: { language: "browser" },
  language: {
    sourceCode: "auto",
    targetCode: "cmn",
    secondaryCode: "original",
    level: "intermediate",
  },
  providersConfig: DEFAULT_PROVIDER_CONFIG_LIST,
  appearance: { colorTheme: "terra", mode: "system" },
  reading: {
    wordPrefixEmphasis: false,
  },
  siteRules: { userRules: [], disabledBuiltInRules: [] },
  features: { disabledSites: [], inputTranslation: true, hoverTranslation: false, hoverStream: true, hoverHotkey: "alt", modeShortcut: DEFAULT_MODE_SHORTCUT_KEY, subtitlesShortcut: DEFAULT_SUBTITLES_SHORTCUT_KEY, videoSubtitles: false, videoControls: true, videoExcludedSites: [], subtitleMode: "bilingual", subtitleStyle: DEFAULT_SUBTITLE_STYLE },
  translate: {
    translationFont: "sans",
    providerId: "openai-default",
    mode: "bilingual",
    page: {
      shortcut: DEFAULT_AUTO_TRANSLATE_SHORTCUT_KEY,
    },
    enableAIContentAware: false,
    customPromptsConfig: DEFAULT_TRANSLATE_PROMPTS_CONFIG,
    translationNodeStyle: {
      preset: TRANSLATION_NODE_STYLE_ON_INSTALLED,
      isCustom: false,
      customCSS: null,
    },
  },
}
