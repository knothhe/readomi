export const TRANSLATION_FONTS = ["sans", "serif"] as const
export type TranslationFont = typeof TRANSLATION_FONTS[number]

/** Web translations and subtitles use the same system font stacks. */
export const TRANSLATION_FONT_FAMILIES = {
  sans: "system-ui, \"PingFang SC\", sans-serif",
  serif: "\"Songti SC\", \"STSong\", \"Noto Serif CJK SC\", \"SimSun\", serif",
} as const satisfies Record<TranslationFont, string>
