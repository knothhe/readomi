/** Read YouTube's own caption clearance, including fullscreen and control variants. */
export function createYouTubeCaptionPosition(player: Element) {
  // Keep a window available during gaps between native cues. Both classes are
  // required by YouTube's CSS; omit caption segments so adapters cannot read it.
  const probe = document.createElement("div")
  probe.className = "caption-window ytp-caption-window-bottom"
  probe.dataset.readomiCaptionPositionProbe = ""
  probe.setAttribute("aria-hidden", "true")
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    width: "0",
    height: "0",
    border: "0",
    padding: "0",
  })
  player.append(probe)
  return {
    /** Caption bottom edge in pixels, relative to the video. */
    bottom: (video: { top: number, height: number }): number | undefined => {
      if (video.height <= 0)
        return undefined
      if (probe.parentElement !== player)
        player.append(probe)
      const native = player.querySelector<HTMLElement>(".caption-window.ytp-caption-window-bottom:not([data-readomi-caption-position-probe])")
      const margin = Math.max(0, Number.parseFloat(getComputedStyle(native ?? probe).marginBottom) || 0)
      const rect = player.getBoundingClientRect()
      return rect.height > 0 ? rect.top + rect.height * 0.98 - margin - video.top : video.height * 0.98 - margin
    },
    dispose: () => probe.remove(),
  }
}
