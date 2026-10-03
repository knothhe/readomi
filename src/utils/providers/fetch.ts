import { browser } from "#imports"
import { APP_USER_AGENT } from "@/utils/constants/app"

const USER_AGENT_RULE_ID = 1
let userAgentReady: Promise<void> | undefined

/** Chromium ignores fetch's User-Agent header, so set it at the network layer. */
function ensureUserAgent(): Promise<void> {
  if (!userAgentReady) {
    userAgentReady = browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [USER_AGENT_RULE_ID],
      addRules: [{
        id: USER_AGENT_RULE_ID,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "user-agent", operation: "set", value: APP_USER_AGENT }],
        },
        condition: {
          // Only Readomi's own API fetches; ordinary pages and YouTube's page bridge keep their UA.
          initiatorDomains: [browser.runtime.id],
          resourceTypes: ["xmlhttprequest"],
          regexFilter: "^https?://",
        },
      }],
    }).catch((error) => {
      userAgentReady = undefined
      throw error
    })
  }
  return userAgentReady
}

export async function fetchProvider(url: string | URL, init: RequestInit): Promise<Response> {
  // Firefox honors the explicit header without a network rule or extra permission.
  if (import.meta.env.BROWSER !== "firefox")
    await ensureUserAgent()
  init.signal?.throwIfAborted()
  return fetch(url, init)
}
