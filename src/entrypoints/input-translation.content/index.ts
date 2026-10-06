import "@/utils/zod-config"
import { defineContentScript } from "#imports"
import { bootstrapInputTranslation } from "./runtime"

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  allFrames: true,
  matchAboutBlank: true,
  async main(ctx) {
    await bootstrapInputTranslation(ctx)
  },
})
