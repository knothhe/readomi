import type { ColorTheme } from "./color-theme"
import type { Theme } from "./theme"
import { COLOR_PALETTES, DEFAULT_COLOR_THEME } from "./color-theme"
import { getSystemTheme } from "./theme"

type StyleRoot = Document | ShadowRoot
const roots = new Set<WeakRef<StyleRoot>>()
const tracked = new WeakSet<StyleRoot>()
let current: ColorTheme = DEFAULT_COLOR_THEME
let appearance: Theme | undefined

function apply(root: StyleRoot) {
  const target = root instanceof Document ? root.documentElement : root.host as HTMLElement
  const palette = COLOR_PALETTES[current]
  const primary = (appearance ?? getSystemTheme()) === "dark" ? palette.dark : palette.primary
  // Keep the established CSS variables so users' custom translation CSS still works.
  for (const token of ["primary", "brand", "brand-strong"])
    target.style.setProperty(`--readomi-${token}`, primary)
}

/** A shadow root created later receives the current choice as soon as styles are injected. */
export function trackHostThemeRoot(root: StyleRoot) {
  if (!tracked.has(root)) {
    tracked.add(root)
    roots.add(new WeakRef(root))
  }
  apply(root)
}

/** Recolors existing paragraphs without translating them again or overriding custom CSS. */
export function setHostColorTheme(color: ColorTheme, theme?: Theme) {
  current = color
  appearance = theme
  for (const reference of roots) {
    const root = reference.deref()
    if (root)
      apply(root)
    else
      roots.delete(reference)
  }
}
