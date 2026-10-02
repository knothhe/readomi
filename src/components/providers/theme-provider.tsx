import { useAtomValue } from "jotai"
import { useLayoutEffect, useSyncExternalStore } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { applyColorTheme } from "@/utils/color-theme"
import { setHostColorTheme } from "@/utils/host-color-theme"
import { applyTheme, getSystemTheme, resolveTheme } from "@/utils/theme"

const DARK_QUERY = "(prefers-color-scheme: dark)"

function subscribeToSystemTheme(onChange: () => void) {
  const query = window?.matchMedia?.(DARK_QUERY)
  if (!query)
    return () => {}
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/** Applies the saved appearance to the document or shadow container, following the OS in system mode. */
export function ThemeProvider({
  children,
  container,
}: {
  children: React.ReactNode
  container?: HTMLElement
}) {
  const { colorTheme, mode } = useAtomValue(configFieldsAtomMap.appearance)
  const system = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme)
  const theme = resolveTheme(mode, system)

  useLayoutEffect(() => {
    const target = container ?? document.documentElement
    applyTheme(target, theme)
    applyColorTheme(target, colorTheme, theme)
    setHostColorTheme(colorTheme, theme)
  }, [theme, container, colorTheme])

  return children
}
