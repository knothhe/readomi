import type { UILanguage } from "./ui-language-options"
import { browser, i18n } from "#imports"

interface Message {
  message: string
  placeholders?: Record<string, { content: string }>
}

const catalogs = import.meta.glob<Record<string, Message>>("../locales/*.yml", {
  query: "?readomi-messages",
  import: "default",
  eager: true,
})
type Translate = (key: string, ...args: Array<number | Array<string | number> | undefined>) => string
const browserTranslate = i18n.t.bind(i18n) as Translate
let language: UILanguage = "browser"
const listeners = new Set<() => void>()

/** Format Chrome message substitutions, including named placeholders and literal dollars. */
export function formatUIMessage(entry: Message, substitutions: Array<string | number> = []) {
  const replace = (text: string): string => text.replace(/\$\$|\$([1-9]\d*)|\$([a-z]\w*)\$/gi, (token, index, name) => {
    if (token === "$$")
      return "$"
    if (index)
      return String(substitutions[Number(index) - 1] ?? "")
    const placeholder = Object.entries(entry.placeholders ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
    return placeholder ? replace(placeholder.content) : ""
  })
  return replace(entry.message)
}

// Keep the generated typed translator, and use the same locale files for an explicit choice.
const translate: Translate = (key, ...args) => {
  if (language === "browser" || key.startsWith("@@"))
    return browserTranslate(key, ...args)
  const messageKey = key.replaceAll(".", "_")
  const entry = catalogs[`../locales/${language}.yml`]?.[messageKey] ?? catalogs["../locales/en.yml"]?.[messageKey]
  if (!entry)
    return browserTranslate(key, ...args)
  const count = args.find(arg => typeof arg === "number") as number | undefined
  const substitutions = args.find(Array.isArray) as Array<string | number> | undefined
  const message = formatUIMessage(entry, substitutions ?? (count === undefined ? [] : [count]))
  if (count === undefined)
    return message
  const plural = message.split(" | ")
  if (plural.length === 2)
    return plural[count === 1 ? 0 : 1]
  if (plural.length === 3)
    return plural[count === 0 || count === 1 ? count : 2]
  return plural[0]
}
i18n.t = translate as typeof i18n.t

export function setUILanguage(next: UILanguage) {
  if (language === next)
    return
  language = next
  for (const listener of listeners)
    listener()
}

export function getUILanguagePreference() {
  return language
}

export function getUILocale(): string {
  if (language !== "browser")
    return language
  try {
    return browser.i18n.getUILanguage()
  }
  catch {
    return globalThis.navigator?.language ?? "en"
  }
}

export function subscribeUILanguage(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
