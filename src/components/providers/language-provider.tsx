import type { ReactNode } from "react"
import { useAtomValue } from "jotai"
import { useLayoutEffect, useSyncExternalStore } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getUILanguagePreference, getUILocale, setUILanguage, subscribeUILanguage } from "@/utils/ui-language"

/** Rerender translated text without remounting forms or losing their drafts. */
export function LanguageProvider({ children }: { children: () => ReactNode }) {
  const { language } = useAtomValue(configFieldsAtomMap.ui)
  useSyncExternalStore(subscribeUILanguage, getUILanguagePreference)
  useLayoutEffect(() => {
    setUILanguage(language)
    document.documentElement.lang = getUILocale()
  }, [language])
  return children()
}
