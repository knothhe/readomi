import type { UILanguage } from "./ui-language-options"
import { catalogs, messageIndexes } from "virtual:readomi-ui-messages"
import { browser, i18n } from "#imports"
import { isExtensionContextInvalidatedError, isExtensionContextValid } from "./extension-context"

interface Message {
  message: string
  placeholders?: Record<string, { content: string }>
}

type Translate = (key: string, ...args: Array<number | Array<string | number> | undefined>) => string
const browserTranslate = i18n.t.bind(i18n) as Translate
let language: UILanguage = "browser"
const listeners = new Set<() => void>()
let lastBrowserLocale = globalThis.navigator?.language ?? "en"

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
  const followsBrowser = language === "browser" || key.startsWith("@@")
  let browserMessage: string | undefined
  if (followsBrowser && isExtensionContextValid() && typeof browser.i18n?.getMessage === "function") {
    try {
      lastBrowserLocale = getUILocale()
      browserMessage = browserTranslate(key, ...args)
      // A running page can have newer bundled messages than Chrome's loaded catalog.
      if (browserMessage || key.startsWith("@@"))
        return browserMessage
    }
    catch (error) {
      if (!isExtensionContextInvalidatedError(error))
        throw error
    }
  }
  // A queued render may finish while the old content script is being disposed.
  // Use its bundled messages instead of calling an API Chrome has removed.
  const locale = language === "browser" ? lastBrowserLocale : language
  const messageKey = key.replaceAll(".", "_")
  const index = messageIndexes[messageKey]
  const compact = catalogs[locale]?.[index] ?? catalogs[locale.split("-")[0]]?.[index] ?? catalogs.en?.[index]
  if (compact === undefined || compact === null)
    return browserMessage ?? (isExtensionContextValid() && typeof browser.i18n?.getMessage === "function" ? browserTranslate(key, ...args) : key)
  const entry: Message = typeof compact === "string" ? { message: compact } : { message: compact[0], placeholders: compact[1] }
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
    lastBrowserLocale = browser.i18n.getUILanguage()
    return lastBrowserLocale
  }
  catch {
    return lastBrowserLocale
  }
}

export function subscribeUILanguage(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
