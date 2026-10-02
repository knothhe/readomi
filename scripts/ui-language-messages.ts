import type { Plugin } from "vite"
import { generateChromeMessages, parseMessagesText } from "@wxt-dev/i18n/build"

/** Compile the existing locale files for manual language selection. */
export function uiLanguageMessages(): Plugin {
  return {
    name: "readomi-ui-language-messages",
    enforce: "pre",
    transform(source, id) {
      if (!/\/locales\/[^/]+\.yml\?readomi-messages$/.test(id))
        return
      const messages = generateChromeMessages(parseMessagesText(source, "YAML"))
      return { code: `export default ${JSON.stringify(messages)}`, map: null }
    },
  }
}
