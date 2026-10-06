import type { ContentScriptContext } from "#imports"
import type { Config } from "@/types/config/config"
import { getLocalConfig, watchLocalConfig } from "./config/storage"
import { logger } from "./logger"
import { sendMessage } from "./message"
import { isSiteDisabled } from "./site-disable"

type Track = (dispose: () => void) => void

/** Keeps just the config listener alive on disabled sites, including their embedded frames. */
export async function runWhileSiteEnabled(ctx: ContentScriptContext, start: (track: Track, inactive: () => boolean) => Promise<void>) {
  let stopped = false
  let current: { stopped: boolean, cleanups: Array<() => void> } | null = null
  const stopSession = () => {
    const session = current
    current = null
    if (!session)
      return
    session.stopped = true
    for (const dispose of session.cleanups.splice(0).reverse()) {
      try {
        dispose()
      }
      catch (error) {
        logger.warn("Failed to stop website runtime:", error)
      }
    }
  }
  let unwatch = () => {}
  const timer = ctx.setInterval(() => {}, 1000)
  const cleanup = () => {
    stopped = true
    unwatch()
    clearInterval(timer)
    stopSession()
  }
  ctx.onInvalidated(cleanup)
  try {
    // A cross-origin frame cannot read top.location. The background supplies its tab URL.
    const pageUrl = window === window.top ? location.href : await sendMessage("getTopFrameUrl", undefined)
    const reconcile = async (config: Config | null) => {
      if (stopped || ctx.isInvalid)
        return
      if (isSiteDisabled(pageUrl, config) || isSiteDisabled(location.href, config)) {
        stopSession()
        return
      }
      if (current)
        return
      const session = { stopped: false, cleanups: [] as Array<() => void> }
      current = session
      const inactive = () => stopped || session.stopped || ctx.isInvalid
      const track: Track = dispose => inactive() ? dispose() : session.cleanups.push(dispose)
      try {
        await start(track, inactive)
      }
      catch (error) {
        const wasInactive = inactive()
        if (current === session)
          stopSession()
        if (!wasInactive)
          throw error
        if (!ctx.isInvalid)
          logger.warn("Failed to start website runtime:", error)
      }
    }
    let changed = false
    unwatch = watchLocalConfig((config) => {
      changed = true
      void reconcile(config).catch(error => logger.warn("Failed to update website runtime:", error))
    })
    if (stopped) {
      unwatch()
      return
    }
    const config = await getLocalConfig()
    if (!changed)
      await reconcile(config)
  }
  catch (error) {
    cleanup()
    if (!ctx.isInvalid)
      throw error
  }
}
