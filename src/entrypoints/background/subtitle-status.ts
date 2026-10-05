import { browser } from "#imports"
import { NO_VIDEO_STATUS } from "@/types/subtitle-status"
import { onMessage, sendMessage } from "@/utils/message"

export function setupSubtitleStatus() {
  onMessage("getTabSubtitleStatus", async ({ data: { tabId } }) => {
    const frames = await browser.webNavigation.getAllFrames({ tabId })
    const results = await Promise.allSettled((frames ?? [{ frameId: 0 }]).map(frame => sendMessage("getSubtitleStatus", undefined, tabId, frame.frameId)))
    const states = results.flatMap(result => result.status === "fulfilled" && result.value?.hasVideo ? [result.value] : [])
    const order = ["ready", "delayed", "failed", "waiting", "disabled", "missing", "excluded", "off"]
    states.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))
    return states[0] ?? NO_VIDEO_STATUS
  })
}
