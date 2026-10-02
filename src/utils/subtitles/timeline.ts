export interface SubtitleCue {
  start: number
  end: number
  text: string
}

export function cleanCueText(text: string): string {
  // This also runs inside YouTube's Trusted Types page: do not assign innerHTML.
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }
  return text.replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
    if (!name.startsWith("#"))
      return entities[name.toLowerCase()] ?? entity
    const value = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
    return value > 0 && value <= 0x10FFFF ? String.fromCodePoint(value) : entity
  }).replace(/\s+/g, " ").trim()
}

/** YouTube JSON3 includes word offsets and window-only events in ASR tracks. */
export function parseYouTubeTranscript(body: string): SubtitleCue[] {
  if (!body.trim() || body.length > 5_000_000)
    return []
  try {
    const data = JSON.parse(body)
    if (!Array.isArray(data.events))
      return []
    const cues: SubtitleCue[] = []
    for (const event of data.events.slice(0, 30_000)) {
      if (!Array.isArray(event.segs) || !Number.isFinite(event.tStartMs))
        continue
      const text = cleanCueText(event.segs.map((s: { utf8?: unknown }) => typeof s.utf8 === "string" ? s.utf8 : "").join(""))
      const start = event.tStartMs / 1000
      const end = start + event.dDurationMs / 1000
      if (text && text.length <= 4000 && start >= 0 && Number.isFinite(end) && end > start)
        cues.push({ start, end, text })
    }
    cues.sort((a, b) => a.start - b.start)
    // Scrolling ASR windows overlap. Replace the old window when the next begins.
    return cues.map((cue, index) => ({ ...cue, end: Math.min(cue.end, cues[index + 1]?.start ?? cue.end) })).filter(cue => cue.end > cue.start)
  }
  catch {
    // Some tracks ignore fmt=json3 and return srv3 or legacy timedtext XML.
    const xml = new DOMParser().parseFromString(body, "text/xml")
    return Array.from(xml.querySelectorAll("text, p")).slice(0, 30_000).flatMap((el) => {
      const modern = el.tagName === "p"
      const start = Number(el.getAttribute(modern ? "t" : "start")) / (modern ? 1000 : 1)
      const end = start + Number(el.getAttribute(modern ? "d" : "dur")) / (modern ? 1000 : 1)
      const text = cleanCueText(el.textContent ?? "")
      return text && text.length <= 4000 && Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start ? [{ start, end, text }] : []
    }).sort((a, b) => a.start - b.start)
  }
}

export function readTrackCues(track: TextTrack): SubtitleCue[] {
  return Array.from(track.cues ?? []).flatMap(cue => "text" in cue && typeof cue.text === "string"
    ? [{ start: cue.startTime, end: cue.endTime, text: cleanCueText(cue.text) }]
    : []).filter(cue => cue.text && cue.end > cue.start)
}

export function cueAt(cues: SubtitleCue[], time: number): SubtitleCue | undefined {
  // Binary search keeps long videos cheap to render every 250 ms.
  let low = 0
  let high = cues.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (cues[mid].start <= time)
      low = mid + 1
    else
      high = mid
  }
  const cue = cues[low - 1]
  return cue && cue.end > time ? cue : undefined
}
