export type Theme = "light" | "dark"
export const THEME_MODES = ["system", "light", "dark"] as const
export type ThemeMode = typeof THEME_MODES[number]

/** Read the OS preference independently of the saved appearance choice. */
export function getSystemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light"
}

export function resolveTheme(mode: ThemeMode, system: Theme = getSystemTheme()): Theme {
  return mode === "system" ? system : mode
}

export function applyTheme(target: HTMLElement, theme: Theme) {
  target.classList.remove("light", "dark")
  target.classList.add(theme)
  target.style.colorScheme = theme
}
