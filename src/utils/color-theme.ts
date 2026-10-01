export const COLOR_THEMES = ["terra", "plum", "amber", "teal"] as const
export type ColorTheme = typeof COLOR_THEMES[number]
export const DEFAULT_COLOR_THEME: ColorTheme = "terra"

/** Brand colors shared by the UI, translated paragraphs and toolbar icons. */
export const COLOR_PALETTES = {
  terra: { primary: "#B6533E", dark: "#E9AB91", tint: "#F6E8E1" },
  plum: { primary: "#79546D", dark: "#C7A5BE", tint: "#F0E8EF" },
  amber: { primary: "#946214", dark: "#E2BD78", tint: "#F5EDD9" },
  teal: { primary: "#246F73", dark: "#8AC1C3", tint: "#E4EFED" },
} as const

export function getThemeIconPath(color: ColorTheme, size: number, translated = false): string {
  return `/icon/${color}/${translated ? "translated-" : ""}${size}.png`
}

export function applyColorTheme(target: HTMLElement, color: ColorTheme, appearance: "light" | "dark") {
  const palette = COLOR_PALETTES[color]
  const primary = appearance === "dark" ? palette.dark : palette.primary
  target.dataset.readomiTheme = color
  for (const token of ["primary", "brand", "ring", "link"])
    target.style.setProperty(`--rf-${token}`, primary)
  for (const token of ["primary-foreground", "brand-foreground"])
    target.style.setProperty(`--rf-${token}`, appearance === "dark" ? "#1c1917" : "#fff8ec")
  target.style.setProperty("--rf-accent", appearance === "dark" ? "#342c27" : palette.tint)
}
