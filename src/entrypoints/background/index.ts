import "@/utils/zod-config"
import { browser, defineBackground } from "#imports"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { openOptionsPage } from "@/utils/navigation"
import { setupActionIcons } from "./action-icon"
import { ensureInitializedConfig } from "./config"
import { setupConfigSync } from "./config-sync"
import { setUpDatabaseCleanup } from "./db-cleanup"
import { setupIframeInjection } from "./iframe-injection"
import { setupLLMGenerateTextMessageHandlers } from "./llm-generate-text"
import { setupSiteDisable } from "./site-disable"
import { setupSiteRuleSessions } from "./site-rule-sessions"
import { setupSubtitleState } from "./subtitle-state"
import { setupTranslationProgress } from "./translation-progress"
import { setUpWebPageTranslationQueue } from "./translation-queues"
import { notifyPageTranslationStateChanged, translationMessage } from "./translation-signal"

export default defineBackground({
  type: "module",
  main: () => {
    logger.info("Hello background!", { id: browser.runtime.id })

    browser.runtime.onInstalled.addListener(async (details) => {
      await ensureInitializedConfig()

      if (details.reason === "install") {
        logger.info("[Background] Extension installed")
      }
    })

    onMessage("openOptionsPage", async (message) => {
      logger.info("openOptionsPage", message.data)
      await openOptionsPage(message.data)
    })

    onMessage("getTopFrameUrl", message => message.sender?.tab?.url ?? message.sender?.url ?? "")

    setupConfigSync()
    translationMessage()
    setupSiteDisable(notifyPageTranslationStateChanged)
    setupActionIcons()
    setupTranslationProgress()
    setupSubtitleState()

    setUpWebPageTranslationQueue()
    void setUpDatabaseCleanup()

    setupLLMGenerateTextMessageHandlers()
    setupSiteRuleSessions()

    // Setup on-demand iframe injection after page translation is enabled.
    setupIframeInjection()
  },
})
