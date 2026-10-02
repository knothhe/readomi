import "@/utils/zod-config"
import { defineContentScript } from "#imports"

declare global {
  interface Window {
    __READOMI_HOST_INJECTED__?: boolean
  }
}

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  cssInjectionMode: "manual",
  async main(ctx) {
    // Prevent double injection (manifest-based + programmatic injection)
    if (ctx.isInvalid || window.__READOMI_HOST_INJECTED__)
      return
    window.__READOMI_HOST_INJECTED__ = true
    ctx.onInvalidated(() => window.__READOMI_HOST_INJECTED__ = false)

    try {
      const { bootstrapHostContent } = await import("./runtime")
      if (!ctx.isInvalid)
        await bootstrapHostContent(ctx)
    }
    catch (error) {
      window.__READOMI_HOST_INJECTED__ = false
      if (!ctx.isInvalid)
        throw error
    }
  },
})
