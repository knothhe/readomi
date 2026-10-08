import type { SubtitleCue } from "./timeline"
import type { SubtitleBatchOutcome, SubtitleTranslationItem, TranslateSubtitleBatch } from "./translation-batch"
import { SUBTITLE_BATCH_CHARACTERS, SUBTITLE_BATCH_ITEMS } from "./translation-batch"

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
  private batches = new Set<AbortController>()

  constructor(private translate: (text: string) => Promise<string>, private translateBatch?: TranslateSubtitleBatch) {}

  private item(index: number): SubtitleTranslationItem {
    const cues = this.last.cues
    return { id: `cue-${index}`, text: cues[index].text, before: cues.slice(Math.max(0, index - 2), index).map(cue => cue.text), after: cues.slice(index + 1, index + 3).map(cue => cue.text) }
  }

  private itemKey(item: SubtitleTranslationItem): string {
    return JSON.stringify([item.text, item.before, item.after])
  }

  private key(text: string): string {
    if (!this.translateBatch)
      return text
    const index = this.last.cues.findIndex(cue => cue.text === text && cue.start <= this.last.time && cue.end > this.last.time)
    return index < 0 ? text : this.itemKey(this.item(index))
  }

  get(text: string): string | undefined {
    return this.cache.get(this.key(text))
  }

  hasFailed(text: string): boolean {
    return this.failed.has(this.key(text))
  }

  /** A newly selected service can retry failures without discarding captions. */
  clearFailures() {
    this.failureGeneration++
    this.failed.clear()
  }

  reset() {
    this.seek()
    this.cache.clear()
    this.failed.clear()
    this.active = ""
    this.last = { cues: [], time: 0, rate: 1, text: "" }
  }

  /** Invalidate queued old-position work while retaining already translated cues. */
  seek() {
    this.generation++
    this.batches.forEach(controller => controller.abort())
    this.batches.clear()
    this.pending.clear()
  }

  dispose() {
    this.disposed = true
    this.reset()
  }

  update(cues: SubtitleCue[], time: number, rate: number, text: string) {
    this.last = { cues, time, rate, text }
    const active = text ? this.key(text) : ""
    if (active !== this.active) {
      // A failed current cue can be retried on a later playback of that cue.
      if (text)
        this.failed.delete(this.key(text))
      this.active = active
    }
    const elapsed = Math.max(0, Date.now() - this.latencyUpdatedAt)
    this.latencyMs = Math.max(3000, this.latencyMs * Math.exp(-elapsed / 60_000))
    this.latencyUpdatedAt = Date.now()
    this.pump()
  }

  private pump() {
    if (this.disposed)
      return
    const { cues, time, rate, text } = this.last
    const lookAhead = Math.min(120, Math.max(30, this.latencyMs / 1000 * 3) * Math.max(1, rate))
    if (cues.length && this.translateBatch) {
      this.pumpBatches(lookAhead)
      return
    }
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

  private pumpBatches(lookAhead: number) {
    const { cues, time, text } = this.last
    const ready = (item: SubtitleTranslationItem) => {
      const key = this.itemKey(item)
      return !this.cache.has(key) && !this.pending.has(key) && !this.failed.has(key)
    }
    while (this.batches.size < 3) {
      const current = cues.findIndex(cue => cue.text === text && cue.start <= time && cue.end > time)
      const urgent = current >= 0 && ready(this.item(current))
      if (this.batches.size >= 2 && !urgent)
        return
      const items: SubtitleTranslationItem[] = []
      const keys = new Set<string>()
      let characters = 0
      for (let index = 0; index < cues.length; index++) {
        const cue = cues[index]
        if (cue.end <= time || cue.start > time + lookAhead)
          continue
        const item = this.item(index)
        const key = this.itemKey(item)
        if (!ready(item) || keys.has(key))
          continue
        if (items.length && characters + cue.text.length > SUBTITLE_BATCH_CHARACTERS)
          break
        items.push(item)
        keys.add(key)
        characters += cue.text.length
        if (items.length >= SUBTITLE_BATCH_ITEMS || characters >= SUBTITLE_BATCH_CHARACTERS)
          break
      }
      if (!items.length)
        return
      this.submitBatch(items, urgent)
    }
  }

  private submitBatch(items: SubtitleTranslationItem[], urgent: boolean) {
    const controller = new AbortController()
    const token = this.generation
    const failureToken = this.failureGeneration
    const started = Date.now()
    this.batches.add(controller)
    items.forEach(item => this.pending.add(this.itemKey(item)))
    const apply = (outcomes: SubtitleBatchOutcome[], completed: boolean) => {
      if (token !== this.generation || this.disposed)
        return
      this.latencyMs = Math.max(this.latencyMs, Date.now() - started)
      for (const item of items) {
        const outcome = outcomes.find(outcome => outcome.id === item.id)
        const key = this.itemKey(item)
        if (outcome?.result) {
          if (this.cache.size >= 1000)
            this.cache.delete(this.cache.keys().next().value!)
          this.cache.set(key, outcome.result.text)
        }
        else if (completed && !this.cache.has(key) && failureToken === this.failureGeneration) {
          this.failed.add(key)
        }
      }
    }
    void this.translateBatch!(items, controller.signal, urgent, outcomes => apply(outcomes, false)).then(outcomes => apply(outcomes, true)).catch(() => {
      if (token === this.generation && failureToken === this.failureGeneration && !this.disposed)
        items.filter(item => !this.cache.has(this.itemKey(item))).forEach(item => this.failed.add(this.itemKey(item)))
    }).finally(() => {
      this.batches.delete(controller)
      if (token === this.generation && !this.disposed) {
        items.forEach(item => this.pending.delete(this.itemKey(item)))
        this.pump()
      }
    })
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
