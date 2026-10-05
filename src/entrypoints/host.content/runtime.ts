import type { ContentScriptContext } from "#imports"
import type { ColorTheme } from "@/utils/color-theme"
import type { ThemeMode } from "@/utils/theme"
import { PRELOAD_MARGIN_PX, PRELOAD_THRESHOLD } from "@/utils/constants/translate"
import { setHostColorTheme } from "@/utils/host-color-theme"
import { flushBatchedOperations } from "@/utils/host/dom/batch-dom"
import { removeAllTranslatedWrapperNodes } from "@/utils/host/translate/node-manipulation"
import { retryFailedTranslations } from "@/utils/host/translate/retry-failed"
import { clearSiteRuleStyles, refreshSiteRuleStyles } from "@/utils/host/translate/ui/site-rule-styles"
import { ensurePresetStyles } from "@/utils/host/translate/ui/style-injector"
import { createWordPrefixEmphasisController } from "@/utils/host/word-prefix-emphasis"
import { logger } from "@/utils/logger"
import { onMessage, sendMessage } from "@/utils/message"
import { setHostPreviewConfig, subscribeHostConfig } from "@/utils/site-rules/preview-config"
import { createSiteRulePreviewController } from "@/utils/site-rules/preview-controller"
import { resolveTheme } from "@/utils/theme"
import { setUILanguage } from "@/utils/ui-language"
import { areSamePageTranslationOrigin } from "@/utils/url"
import { setupUrlChangeListener } from "./listen"
import { mountHostToast } from "./mount-host-toast"
import { mountSiteRulePanel } from "./site-rule-panel/mount"
import { bootstrapVideoSubtitles } from "./subtitles/runtime"
import { bindTranslationShortcutKey } from "./translation-control/bind-translation-shortcut"
import { watchConfigChanges } from "./translation-control/handle-config-change"
import { bindHoverTranslation } from "./translation-control/hover-translation"
import { PageTranslationManager } from "./translation-control/page-translation"

export async function bootstrapHostContent(ctx: ContentScriptContext) {
  if (ctx.isInvalid)
    return

  const cleanups: Array<() => void> = []
  let stopped = false
  const cleanup = () => {
    if (stopped)
      return
    stopped = true
    for (const dispose of cleanups.splice(0).reverse()) {
      try {
        dispose()
      }
      catch (error) {
        logger.warn("Failed to clean up content script:", error)
      }
    }
    window.__READOMI_HOST_INJECTED__ = false
  }
  // Register before the first await, so an update during startup also cleans up.
  ctx.onInvalidated(cleanup)
  const track = (dispose: () => void) => {
    if (stopped)
      dispose()
    else
      cleanups.push(dispose)
  }
  // WXT checks runtime.id in isInvalid; onInvalidated alone does not poll it.
  const timer = ctx.setInterval(() => {}, 1000)
  track(() => clearInterval(timer))
  try {
    await startHostContent(ctx, track)
  }
  catch (error) {
    cleanup()
    if (!ctx.isInvalid)
      throw error
  }
}

async function startHostContent(ctx: ContentScriptContext, track: (dispose: () => void) => void) {
  ensurePresetStyles(document)
  track(clearSiteRuleStyles)
  let colorTheme: ColorTheme = "terra"
  let appearanceMode: ThemeMode = "system"
  const unsubscribeColorTheme = subscribeHostConfig((config) => {
    if (config)
      refreshSiteRuleStyles(config)
    setUILanguage(config?.ui.language ?? "browser")
    colorTheme = config?.appearance.colorTheme ?? "terra"
    appearanceMode = config?.appearance.mode ?? "system"
    setHostColorTheme(colorTheme, resolveTheme(appearanceMode))
  })
  const appearanceQuery = window.matchMedia?.("(prefers-color-scheme: dark)")
  const updateAppearance = () => setHostColorTheme(colorTheme, resolveTheme(appearanceMode))
  track(unsubscribeColorTheme)
  appearanceQuery?.addEventListener("change", updateAppearance)
  track(() => appearanceQuery?.removeEventListener("change", updateAppearance))
  let cleanupHoverTranslation = () => {}
  let hoverBound = false
  track(() => cleanupHoverTranslation())
  const cleanupVideoSubtitles = bootstrapVideoSubtitles(() => ctx.isInvalid)
  track(cleanupVideoSubtitles)

  const cleanupUrlListener = setupUrlChangeListener()
  track(cleanupUrlListener)

  const removeHostToast = window === window.top ? mountHostToast() : () => {}
  track(removeHostToast)

  const manager = new PageTranslationManager({
    root: null,
    rootMargin: `${PRELOAD_MARGIN_PX}px`,
    threshold: PRELOAD_THRESHOLD,
  })
  track(() => manager.dispose())
  track(onMessage("refreshPageTranslation", async ({ data }) => {
    if (ctx.isInvalid || (window === window.top && location.href !== data.url))
      throw new Error("The page changed. Reopen the popup and try again.")
    if (data.failedOnly)
      await retryFailedTranslations(manager.requestSignal)
    else
      await manager.restart()
  }))

  let previewRestoring = false
  let pageTranslationWanted = false
  const previewController = createSiteRulePreviewController({
    async resetTranslation(config, _generation, isCurrent) {
      if (!previewRestoring)
        pageTranslationWanted = manager.isActive
      previewRestoring = true
      cleanupHoverTranslation()
      manager.suspend()
      removeAllTranslatedWrapperNodes(document)
      flushBatchedOperations()
      clearSiteRuleStyles()
      await setHostPreviewConfig(config)
      if (ctx.isInvalid || !isCurrent())
        return
      cleanupHoverTranslation = bindHoverTranslation()
      hoverBound = true
      if (pageTranslationWanted)
        await manager.start()
      if (isCurrent())
        previewRestoring = false
    },
  })
  track(() => previewController.dispose())
  track(() => {
    void setHostPreviewConfig(null)
  })
  if (window === window.top)
    track(mountSiteRulePanel(previewController))

  // Translate the page again when the popup or the options page changes the translation mode.
  // A change before this point needs no action: page translation starts later and reads the current config.
  const unwatchConfig = watchConfigChanges(manager)
  track(unwatchConfig)

  // Turn the word-prefix emphasis on and off when the reader changes the setting.
  const wordPrefixEmphasis = createWordPrefixEmphasisController(document)
  const unsubscribeWordPrefixEmphasis = subscribeHostConfig(config => wordPrefixEmphasis.setEnabled(config?.reading.wordPrefixEmphasis === true))

  track(unsubscribeWordPrefixEmphasis)
  track(() => wordPrefixEmphasis.setEnabled(false))

  await previewController.reload()
  if (ctx.isInvalid)
    return
  if (!hoverBound) {
    cleanupHoverTranslation = bindHoverTranslation()
    hoverBound = true
  }

  const cleanupTranslationShortcut = await bindTranslationShortcutKey(manager, document, () => ctx.isInvalid)
  track(cleanupTranslationShortcut)
  if (ctx.isInvalid)
    return

  // For late-loading iframes: check if translation is already enabled for this tab
  let translationEnabled = false
  try {
    translationEnabled = await sendMessage("getEnablePageTranslationFromContentScript", undefined)
  }
  catch (error) {
    if (!ctx.isInvalid)
      logger.error("Failed to check translation state:", error)
  }
  if (ctx.isInvalid)
    return
  if (translationEnabled) {
    pageTranslationWanted = true
    await manager.start()
  }

  const handleUrlChange = async (from: string, to: string) => {
    if (!ctx.isInvalid && from !== to) {
      logger.info("URL changed from", from, "to", to)
      if (previewController.getReport().session?.status === "previewing")
        return
      if (manager.isActive) {
        if (areSamePageTranslationOrigin(from, to)) {
          await manager.restart()
        }
        else {
          manager.stop()
        }
      }
    }
  }

  const handleExtensionUrlChange = (e: any) => {
    const { from, to } = e.detail
    void handleUrlChange(from, to).catch((error) => {
      if (!ctx.isInvalid)
        logger.error("Failed to handle URL change:", error)
    })
  }
  window.addEventListener("extension:URLChange", handleExtensionUrlChange)
  track(() => window.removeEventListener("extension:URLChange", handleExtensionUrlChange))

  // Listen for translation state changes from background
  const cleanupTranslationStateListener = onMessage("askManagerToTogglePageTranslation", (msg) => {
    const { enabled } = msg.data
    pageTranslationWanted = enabled
    if (previewRestoring)
      return
    if (enabled === manager.isActive)
      return
    enabled ? void manager.start() : manager.stop()
  })

  const cleanupFrameTranslationStateListener = window === window.top
    ? () => {}
    : onMessage("notifyTranslationStateChanged", (msg) => {
        const { enabled } = msg.data
        pageTranslationWanted = enabled
        if (previewRestoring)
          return
        if (enabled === manager.isActive)
          return
        enabled ? void manager.start() : manager.stop()
      })

  const cleanupDetectedLanguageRefreshListener = window === window.top
    // Older background contexts can still send this message after an update.
    // Each translation now identifies its own source in the translation request.
    ? onMessage("refreshDetectedPageLanguage", () => {})
    : () => {}

  track(cleanupTranslationStateListener)
  track(cleanupFrameTranslationStateListener)
  track(cleanupDetectedLanguageRefreshListener)
}
