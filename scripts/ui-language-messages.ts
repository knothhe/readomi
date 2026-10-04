import type { ChromeMessage } from "@wxt-dev/i18n/build"
import type { CompactUIMessage } from "virtual:readomi-ui-messages"
import type { Plugin } from "vite"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generateChromeMessages, parseMessagesText } from "@wxt-dev/i18n/build"

const moduleId = "virtual:readomi-ui-messages"
const resolvedModuleId = `\0${moduleId}`
const localesDirectory = fileURLToPath(new URL("../src/locales", import.meta.url))

/** Store keys once and omit message wrappers that contain no placeholders. */
export function compileUICatalogs(messages: Record<string, Record<string, ChromeMessage>>) {
  const keys = [...new Set(Object.values(messages).flatMap(Object.keys))].sort()
  const messageIndexes = Object.fromEntries(keys.map((key, index) => [key, index]))
  const catalogs = Object.fromEntries(Object.entries(messages).map(([locale, entries]) => [
    locale,
    keys.map((key): CompactUIMessage | null => {
      const entry = entries[key]
      if (!entry)
        return null
      return entry.placeholders ? [entry.message, entry.placeholders] : entry.message
    }),
  ]))
  return { messageIndexes, catalogs }
}

/** Compile the existing locale files for manual language selection. */
export function uiLanguageMessages(): Plugin {
  return {
    name: "readomi-ui-language-messages",
    enforce: "pre",
    resolveId(id) {
      if (id === moduleId)
        return resolvedModuleId
    },
    async load(id) {
      if (id !== resolvedModuleId)
        return
      const files = (await readdir(localesDirectory)).filter(file => file.endsWith(".yml")).sort()
      const messages = Object.fromEntries(await Promise.all(files.map(async (file) => {
        const filename = path.join(localesDirectory, file)
        this.addWatchFile(filename)
        return [file.slice(0, -4), generateChromeMessages(parseMessagesText(await readFile(filename, "utf8"), "YAML"))]
      })))
      const { messageIndexes, catalogs } = compileUICatalogs(messages)
      return `export const messageIndexes = ${JSON.stringify(messageIndexes)}; export const catalogs = ${JSON.stringify(catalogs)};`
    },
    handleHotUpdate({ file, server }) {
      if (path.dirname(file) !== localesDirectory || !file.endsWith(".yml"))
        return
      const module = server.moduleGraph.getModuleById(resolvedModuleId)
      if (module) {
        server.moduleGraph.invalidateModule(module)
        return [module]
      }
    },
  }
}
