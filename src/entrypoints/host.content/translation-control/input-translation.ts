import type { Config } from "@/types/config/config"
import type { Editable } from "@/utils/input-translation/editable"
import { i18n } from "#imports"
import { toast } from "@/components/toast"
import { describeTranslationError } from "@/utils/error/translation-error"
import { isExtensionContextInvalidatedError } from "@/utils/extension-context"
import { validateTranslationConfigAndToast } from "@/utils/host/translate/translate-text"
import { translateTextForInput } from "@/utils/host/translate/translate-variants"
import { getDeepActiveElement, getEditable, readEditableText } from "@/utils/input-translation/editable"
import { replaceEditableText } from "@/utils/input-translation/replace-text"
import { getHostConfig, watchHostConfig } from "@/utils/site-rules/preview-config"

const SPACE_INTERVAL_MS = 300

function showPending(element: Editable): () => void {
  const doc = element.ownerDocument
  const indicator = doc.createElement("span")
  indicator.className = "readomi-input-pending notranslate"
  indicator.setAttribute("role", "status")
  indicator.setAttribute("aria-label", i18n.t("inputTranslation.pending"))
  indicator.style.cssText = "position:fixed!important;display:block!important;width:12px!important;height:12px!important;min-width:12px!important;max-width:12px!important;min-height:12px!important;max-height:12px!important;margin:0!important;padding:0!important;border:2px solid #e8e0db!important;border-top-color:var(--readomi-primary,#b6533e)!important;border-radius:50%!important;box-sizing:border-box!important;pointer-events:none!important;z-index:2147483647!important;"
  const win = doc.defaultView!
  let frame = 0
  let previousTop: number | undefined
  let previousLeft: number | undefined
  const update = () => {
    const rect = element.getBoundingClientRect()
    const top = Math.max(rect.top, rect.bottom - 24)
    const left = Math.max(rect.left, rect.right - 24)
    if (top !== previousTop || left !== previousLeft) {
      indicator.style.setProperty("top", `${top}px`, "important")
      indicator.style.setProperty("left", `${left}px`, "important")
      previousTop = top
      previousLeft = left
    }
    // Layout shifts and editor resizing need no window resize or scroll event.
    frame = win.requestAnimationFrame(update)
  }
  update()
  // A transformed body must not become the fixed indicator's containing block.
  doc.documentElement.append(indicator)
  if (!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
    indicator.animate?.([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 600, iterations: Infinity })
  return () => {
    win.cancelAnimationFrame(frame)
    indicator.remove()
  }
}

function translationSettings(config: Config | null) {
  return JSON.stringify(config && [config.language, config.translate.providerId, config.translate.customPromptsConfig, config.providersConfig, config.features.inputTranslation])
}

/** Three separate spaces in one focused editor, following Read Frog's 300 ms cadence. */
export async function bindInputTranslation(doc: Document = document, isContextInvalid: () => boolean = () => false): Promise<() => void> {
  let config = await getHostConfig()
  if (isContextInvalid())
    return () => {}
  let stopped = false
  let lastEditor: Editable | null = null
  let lastPress = 0
  let count = 0
  const jobs = new Map<Editable, AbortController>()
  const reset = () => {
    lastEditor = null
    count = 0
  }
  const cancel = () => {
    reset()
    for (const controller of jobs.values())
      controller.abort()
  }
  const unwatch = watchHostConfig((next) => {
    if (translationSettings(config) !== translationSettings(next))
      cancel()
    config = next
  })

  const translate = async (element: Editable, snapshot: Config) => {
    const original = readEditableText(element)
    const text = original.trim()
    if (!text || jobs.has(element) || !validateTranslationConfigAndToast(snapshot))
      return
    const controller = new AbortController()
    jobs.set(element, controller)
    const hide = showPending(element)
    controller.signal.addEventListener("abort", () => {
      hide()
      if (jobs.get(element) === controller)
        jobs.delete(element)
    }, { once: true })
    const abort = () => controller.abort()
    // Any edit invalidates the result, even if the user later types the original again.
    element.addEventListener("input", abort, true)
    element.addEventListener("compositionstart", abort, true)
    // focusin alone misses blur to the document body followed by refocusing.
    element.addEventListener("blur", abort, true)
    try {
      const translated = await translateTextForInput(text, snapshot, controller.signal)
      if (stopped || isContextInvalid() || controller.signal.aborted || !element.isConnected
        || getEditable(getDeepActiveElement(doc)) !== element || getEditable(element) !== element
        || readEditableText(element) !== original || !translated) {
        return
      }
      element.removeEventListener("input", abort, true)
      const replaced = await replaceEditableText(element, translated, original, controller.signal)
      if (!replaced && !controller.signal.aborted && !stopped && !isContextInvalid())
        toast.error(i18n.t("inputTranslation.replaceFailed"))
    }
    catch (error) {
      if (!stopped && !isContextInvalid() && !controller.signal.aborted && !isExtensionContextInvalidatedError(error)) {
        toast.error(i18n.t("inputTranslation.failed"), {
          description: describeTranslationError(error instanceof Error ? error : new Error(String(error))),
        })
      }
    }
    finally {
      element.removeEventListener("input", abort, true)
      element.removeEventListener("compositionstart", abort, true)
      element.removeEventListener("blur", abort, true)
      hide()
      if (jobs.get(element) === controller)
        jobs.delete(element)
    }
  }

  const keydown = (event: KeyboardEvent) => {
    if (stopped || isContextInvalid() || !config?.features.inputTranslation || event.defaultPrevented
      || event.key !== " " || event.repeat || event.isComposing || event.keyCode === 229
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      reset()
      return
    }
    const element = getEditable(getDeepActiveElement(doc))
    if (!element || jobs.has(element)) {
      reset()
      return
    }
    const now = Date.now()
    count = element === lastEditor && now - lastPress <= SPACE_INTERVAL_MS ? count + 1 : 1
    lastEditor = element
    lastPress = now
    if (count < 3)
      return
    reset()
    if (!readEditableText(element).trim())
      return
    event.preventDefault()
    event.stopPropagation()
    void translate(element, config)
  }
  const focusChanged = () => {
    reset()
    for (const [element, controller] of jobs) {
      if (getEditable(getDeepActiveElement(doc)) !== element)
        controller.abort()
    }
  }
  const win = doc.defaultView!
  doc.addEventListener("keydown", keydown, true)
  doc.addEventListener("focusin", focusChanged, true)
  doc.addEventListener("compositionstart", reset, true)
  win.addEventListener("blur", cancel)
  return () => {
    stopped = true
    cancel()
    unwatch()
    doc.removeEventListener("keydown", keydown, true)
    doc.removeEventListener("focusin", focusChanged, true)
    doc.removeEventListener("compositionstart", reset, true)
    win.removeEventListener("blur", cancel)
  }
}
