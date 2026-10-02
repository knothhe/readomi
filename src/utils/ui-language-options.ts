export const UI_LANGUAGES = ["browser", "en", "zh-CN", "zh-TW", "ja", "ko", "es", "ru", "tr", "vi"] as const
export type UILanguage = typeof UI_LANGUAGES[number]

// Native names keep the selector usable even in an unfamiliar language.
export const UI_LANGUAGE_NAMES: Record<Exclude<UILanguage, "browser">, string> = {
  "en": "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "ja": "日本語",
  "ko": "한국어",
  "es": "Español",
  "ru": "Русский",
  "tr": "Türkçe",
  "vi": "Tiếng Việt",
}
