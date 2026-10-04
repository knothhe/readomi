import type { LangCodeISO6393 } from "@/definitions"
import type { Config } from "@/types/config/config"
import { getLanguageDirectionAndLang } from "@/utils/content/language-direction"

export function setTranslationDirAndLang(element: HTMLElement, language: Config | LangCodeISO6393): void {
  const targetCode = typeof language === "string" ? language : language.language.targetCode
  const { dir, lang } = getLanguageDirectionAndLang(targetCode)
  element.setAttribute("dir", dir)

  if (lang) {
    element.setAttribute("lang", lang)
  }
  else {
    element.removeAttribute("lang")
  }
}
