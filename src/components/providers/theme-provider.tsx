import type { Theme } from "@/utils/theme"
import { useAtomValue } from "jotai"
import { useLayoutEffect, useSyncExternalStore } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { applyColorTheme } from "@/utils/color-theme"
import { setHostColorTheme } from "@/utils/host-color-theme"
import { applyTheme, getSystemTheme } from "@/utils/theme"

const DARK_QUERY = "(prefers-color-scheme: dark)"

function subscribeToSystemTheme(onChange: () => void) {
  const query = window?.matchMedia?.(DARK_QUERY)
  if (!query)
    return () => {}
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/** Applies the system appearance to the document, or to a shadow root container, and follows its changes. */
export function ThemeProvider({
  children,
  container,
}: {
  children: React.ReactNode
  container?: HTMLElement
}) {
  const { colorTheme } = useAtomValue(configFieldsAtomMap.appearance)
  const theme: Theme = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme)

  useLayoutEffect(() => {
    const target = container ?? document.documentElement
    applyTheme(target, theme)
    applyColorTheme(target, colorTheme, theme)
    setHostColorTheme(colorTheme)
  }, [theme, container, colorTheme])

  return children
}
