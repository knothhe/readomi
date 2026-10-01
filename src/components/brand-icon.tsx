import { useAtomValue } from "jotai"
import { browser } from "#imports"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getThemeIconPath } from "@/utils/color-theme"

export function BrandIcon({ className, size = 32 }: { className?: string, size?: number }) {
  const { colorTheme } = useAtomValue(configFieldsAtomMap.appearance)
  return <img src={new URL(getThemeIconPath(colorTheme, size), browser.runtime.getURL("/")).href} alt="" className={className} />
}
