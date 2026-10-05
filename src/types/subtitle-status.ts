export interface SubtitleStatus {
  hasVideo: boolean
  state: "off" | "excluded" | "disabled" | "missing" | "waiting" | "ready" | "delayed" | "failed"
}

export const NO_VIDEO_STATUS: SubtitleStatus = { hasVideo: false, state: "off" }
