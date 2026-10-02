/** The top edge of visible YouTube bottom controls, relative to the video. */
export function visibleYouTubeControlsTop(player: Element | null, video: { top: number, height: number }): number | undefined {
  if (!player || video.height <= 0)
    return undefined
  let top: number | undefined
  for (const control of player.querySelectorAll<HTMLElement>(".ytp-chrome-bottom, .ytp-progress-bar-container")) {
    let visible = true
    for (let node: Element | null = control; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (node.hasAttribute("hidden") || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || (style.opacity !== "" && Number(style.opacity) <= 0.01)) {
        visible = false
        break
      }
      if (node === player)
        break
    }
    if (!visible)
      continue
    const rect = control.getBoundingClientRect()
    const relativeTop = rect.top - video.top
    if (rect.width <= 0 || rect.height <= 0 || relativeTop < video.height / 2 || relativeTop >= video.height)
      continue
    top = Math.min(top ?? relativeTop, relativeTop)
  }
  return top
}
