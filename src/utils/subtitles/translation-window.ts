import type { SubtitleCue } from "./timeline"

/** Only submit work near the latest playback position; no full-video FIFO. */
export class SubtitleTranslationWindow {
  private cache = new Map<string, string>()
  private pending = new Set<string>()
  private failed = new Set<string>()
  private generation = 0
  private failureGeneration = 0
  private disposed = false
  private latencyMs = 3000
  private latencyUpdatedAt = Date.now()
  private active = ""
  private last = { cues: [] as SubtitleCue[], time: 0, rate: 1, text: "" }

  constructor(private translate: (text: string) => Promise<string>) {}

  get(text: string): string | undefined {
    return this.cache.get(text)
  }

  hasFailed(text: string): boolean {
    return this.failed.has(text)
  }

  /** A newly selected service can retry failures without discarding captions. */
  clearFailures() {
    this.failureGeneration++
    this.failed.clear()
  }

  reset() {
    this.generation++
    this.cache.clear()
    this.pending.clear()
    this.failed.clear()
    this.active = ""
    this.last = { cues: [], time: 0, rate: 1, text: "" }
  }

  dispose() {
    this.disposed = true
    this.reset()
  }

  update(cues: SubtitleCue[], time: number, rate: number, text: string) {
    if (text !== this.active) {
      // A failed current cue can be retried on a later playback of that cue.
      if (text)
        this.failed.delete(text)
      this.active = text
    }
    const elapsed = Math.max(0, Date.now() - this.latencyUpdatedAt)
    this.latencyMs = Math.max(3000, this.latencyMs * Math.exp(-elapsed / 60_000))
    this.latencyUpdatedAt = Date.now()
    this.last = { cues, time, rate, text }
    this.pump()
  }

  private pump() {
    if (this.disposed)
      return
    const { cues, time, rate, text } = this.last
    const lookAhead = Math.min(120, Math.max(30, this.latencyMs / 1000 * 3) * Math.max(1, rate))
    if (text)
      this.submit(text, true)
    // Submit several items together so the existing background queue can batch.
    // Slots 9–10 are reserved for a new current cue after a seek.
    for (const cue of cues) {
      if (cue.end <= time || cue.start > time + lookAhead)
        continue
      if (this.pending.size >= 8)
        break
      this.submit(cue.text, false)
    }
  }

  private submit(text: string, urgent: boolean) {
    if (this.cache.has(text) || this.pending.has(text) || this.failed.has(text) || this.pending.size >= (urgent ? 10 : 8))
      return
    const token = this.generation
    const failureToken = this.failureGeneration
    const started = Date.now()
    this.pending.add(text)
    void this.translate(text).then((result) => {
      if (token !== this.generation || this.disposed)
        return
      this.latencyMs = Math.max(this.latencyMs, Date.now() - started)
      if (this.cache.size >= 1000)
        this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(text, result)
    }).catch(() => {
      if (token === this.generation && failureToken === this.failureGeneration && !this.disposed)
        this.failed.add(text)
    }).finally(() => {
      if (token === this.generation && !this.disposed) {
        this.pending.delete(text)
        this.pump()
      }
    })
  }
}
