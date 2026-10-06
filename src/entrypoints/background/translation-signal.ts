import { browser, storage } from "#imports"
import { getTranslationStateKey } from "@/utils/constants/storage-keys"
import { logger } from "@/utils/logger"
import { onMessage, sendMessage } from "@/utils/message"
import { updateActionIcon } from "./action-icon"
import { injectHostContentIntoTabIframes } from "./iframe-injection"
import {
  getPageTranslationEnabled,
  getPageTranslationState,
  isPageTranslationStateInUrlScope,
  setPageTranslationEnabled,
} from "./page-translation-state"
import { isTabSiteDisabled } from "./site-disable"

export function notifyPageTranslationStateChanged(tabId: number, enabled: boolean) {
  void sendMessage("notifyTranslationStateChanged", { enabled }, tabId)
    .catch(error => logger.warn("Failed to notify page translation state change", error))
  // The popup is often closed, so having no receiver is expected.
  void sendMessage("pageTranslationStateChanged", { tabId, enabled }).catch(() => {})
  void updateActionIcon(tabId, enabled)
}

function requestManagerToTogglePageTranslation(tabId: number, enabled: boolean) {
  void sendMessage("askManagerToTogglePageTranslation", { enabled }, tabId)
    .catch(error => logger.warn("Failed to ask page translation manager to toggle", error))
}

function isIframe(frameId: number | undefined): boolean {
  return frameId !== undefined && frameId !== 0
}

export function translationMessage() {
  onMessage("getEnablePageTranslationByTabId", async (msg) => {
    const { tabId } = msg.data
    return await getTranslationState(tabId)
  })

  onMessage("getEnablePageTranslationFromContentScript", async (msg) => {
    const tabId = msg.sender?.tab?.id
    if (typeof tabId === "number") {
      return await getTranslationState(tabId)
    }
    logger.error("Invalid tabId in getEnablePageTranslationFromContentScript", msg)
    return false
  })

  // Compatibility for older extension contexts after an update. Source language
  // is now inferred per translation request, so no page detection is stored.
  onMessage("reportDetectedPageLanguage", () => {})
  onMessage("getDetectedCode", () => "eng")

  onMessage("tryToSetEnablePageTranslationByTabId", async (msg) => {
    const { tabId, enabled } = msg.data
    if (enabled && await isTabSiteDisabled(tabId))
      return
    if (!enabled) {
      await setPageTranslationEnabled(tabId, false)
      notifyPageTranslationStateChanged(tabId, false)
    }
    requestManagerToTogglePageTranslation(tabId, enabled)
  })

  onMessage("setAndNotifyPageTranslationStateChangedByManager", async (msg) => {
    const tabId = msg.sender?.tab?.id
    const { enabled, url } = msg.data
    if (typeof tabId === "number") {
      if (enabled && await isTabSiteDisabled(tabId)) {
        await setPageTranslationEnabled(tabId, false)
        notifyPageTranslationStateChanged(tabId, false)
        return
      }
      const senderFrameId = msg.sender?.frameId

      if (enabled && isIframe(senderFrameId)) {
        // Iframe enabled echoes only synchronize UI; they must not write
        // tab-level state because that state is scoped to the top-frame origin.
        const currentState = await getPageTranslationState(tabId)
        if (!currentState?.enabled)
          return

        notifyPageTranslationStateChanged(tabId, true)
        return
      }

      await setPageTranslationEnabled(tabId, enabled, url ?? msg.sender?.tab?.url)
      notifyPageTranslationStateChanged(tabId, enabled)

      if (enabled && !isIframe(senderFrameId)) {
        void injectHostContentIntoTabIframes(tabId)
      }
    }
    else {
      logger.error("tabId is not a number", msg)
    }
  })

  // === Helper Functions ===
  async function getTranslationState(tabId: number): Promise<boolean> {
    return !await isTabSiteDisabled(tabId) && await getPageTranslationEnabled(tabId)
  }

  // === Cleanup ===
  browser.tabs.onRemoved.addListener(async (tabId) => {
    await storage.removeItem(getTranslationStateKey(tabId))
  })

  // Clear translation state only when the tab leaves the origin where it was enabled.
  browser.webNavigation.onCommitted.addListener(async (details) => {
    // Only handle main frame navigations, not iframes
    if (details.frameId !== 0)
      return

    const state = await getPageTranslationState(details.tabId)
    if (!state?.enabled)
      return

    if (isPageTranslationStateInUrlScope(state, details.url))
      return

    await storage.removeItem(getTranslationStateKey(details.tabId))
    void updateActionIcon(details.tabId, false)
  })
}
