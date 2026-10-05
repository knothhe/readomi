import type { TranslationProgress } from "@/types/translation-progress"
import { EMPTY_TRANSLATION_PROGRESS } from "@/types/translation-progress"
import { sendMessage } from "@/utils/message"

const REPORT_DELAY_MS = 150

let progress: TranslationProgress = EMPTY_TRANSLATION_PROGRESS
let generation = 0
let reportTimer: ReturnType<typeof setTimeout> | null = null

function report() {
  // The background may be asleep or the extension reloading; progress is
  // advisory, so a failed report is dropped rather than surfaced.
  void sendMessage("reportTranslationProgress", progress).catch(() => {})
}

function scheduleReport() {
  if (reportTimer)
    return
  reportTimer = setTimeout(() => {
    reportTimer = null
    report()
  }, REPORT_DELAY_MS)
}

export function trackTranslationStarted() {
  progress = { ...progress, total: progress.total + 1 }
  scheduleReport()
  return generation
}

export function trackTranslationRetry() {
  if (progress.failed === 0)
    return
  progress = { total: Math.max(0, progress.total - 1), done: Math.max(0, progress.done - 1), failed: progress.failed - 1 }
  scheduleReport()
}

export function trackTranslationFinished(succeeded: boolean, requestGeneration = generation) {
  if (requestGeneration !== generation)
    return
  progress = {
    total: progress.total,
    done: progress.done + 1,
    failed: progress.failed + (succeeded ? 0 : 1),
  }
  scheduleReport()
}

export function trackTranslationCancelled(requestGeneration = generation) {
  if (requestGeneration !== generation)
    return
  progress = { ...progress, total: Math.max(progress.done, progress.total - 1) }
  scheduleReport()
}

export function resetTranslationProgress() {
  generation++
  progress = EMPTY_TRANSLATION_PROGRESS
  if (reportTimer) {
    clearTimeout(reportTimer)
    reportTimer = null
  }
  report()
}

export function getTranslationProgress(): TranslationProgress {
  return progress
}
