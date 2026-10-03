function subtitleTracks(video: HTMLVideoElement): TextTrack[] {
  return Array.from(video.textTracks).filter(track => track.kind === "subtitles" || track.kind === "captions")
}

/** Own native caption modes only while an actual source track is available. */
export function createTextTrackSession(video: HTMLVideoElement, isSourceTrack: (track: TextTrack) => boolean = () => true) {
  const playerModes = new Map<TextTrack, TextTrackMode>()
  let selected: TextTrack | undefined
  let watched: TextTrackList | undefined
  let updating = false
  let disposed = false
  const restore = () => {
    updating = true
    for (const [track, mode] of playerModes) {
      if (track.mode === "hidden")
        track.mode = mode
    }
    playerModes.clear()
    updating = false
  }
  const sync = (): TextTrack | undefined => {
    if (disposed || updating)
      return selected
    if (watched !== video.textTracks) {
      watched?.removeEventListener?.("change", sync)
      watched?.removeEventListener?.("addtrack", sync)
      watched = video.textTracks
      watched.addEventListener?.("change", sync)
      watched.addEventListener?.("addtrack", sync)
    }
    const tracks = subtitleTracks(video)
    const sources = tracks.filter(isSourceTrack)
    selected = sources.find(track => track.mode === "showing")
      ?? (selected && sources.includes(selected) ? selected : sources.find(track => track.kind === "subtitles") ?? sources[0])
    if (!selected) {
      restore()
      return undefined
    }
    updating = true
    for (const track of tracks) {
      // "hidden" is our mode. Any other mode is the player's latest request.
      if (track.mode !== "hidden")
        playerModes.set(track, track.mode)
      if (track.mode === "showing" || (track === selected && track.mode === "disabled"))
        track.mode = "hidden"
    }
    updating = false
    return selected
  }
  return {
    sync,
    reset: () => {
      selected = undefined
      restore()
    },
    dispose: () => {
      disposed = true
      watched?.removeEventListener?.("change", sync)
      watched?.removeEventListener?.("addtrack", sync)
      restore()
    },
  }
}
