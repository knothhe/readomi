import { useCallback, useEffect, useId, useRef, useState } from "react"
import { i18n } from "#imports"
import { isModifierKey } from "@/utils/hotkeys"
import { formatPageTranslationShortcut, isValidConfiguredPageTranslationShortcut, keyboardEventToPageTranslationShortcut } from "@/utils/page-translation-shortcut"
import { cn } from "@/utils/styles/utils"

const CLEAR_KEYS = new Set(["Backspace", "Delete"])

export function ShortcutKeyRecorder(
  { shortcutKey: initialShortcutKey, onChange, className, id }:
  { shortcutKey: string, onChange?: (shortcutKey: string) => void | boolean, className?: string, id?: string },
) {
  const [inRecording, setInRecording] = useState(false)
  const [optimisticShortcut, setOptimisticShortcut] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const isRecordingRef = useRef(false)
  const descriptionId = useId()

  const endRecording = useCallback((nextShortcut: string | null) => {
    isRecordingRef.current = false
    setInRecording(false)

    if (nextShortcut !== null) {
      const accepted = onChange?.(nextShortcut) !== false
      setOptimisticShortcut(accepted ? nextShortcut : null)
    }
  }, [onChange])

  const cancelRecording = useCallback(() => {
    endRecording(null)
  }, [endRecording])

  const clearShortcut = useCallback(() => {
    endRecording("")
  }, [endRecording])

  const commitShortcut = useCallback((nextShortcut: string) => {
    endRecording(nextShortcut)
  }, [endRecording])

  const startRecord = () => {
    if (isRecordingRef.current || buttonRef.current?.closest("[hidden]")) {
      return
    }

    isRecordingRef.current = true
    setInRecording(true)
  }

  const handleBlur = () => {
    if (!isRecordingRef.current) {
      return
    }

    cancelRecording()
  }

  useEffect(() => {
    if (!inRecording) {
      return
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (!isRecordingRef.current) {
        return
      }

      if (buttonRef.current?.closest("[hidden]")) {
        cancelRecording()
        return
      }

      if (event.key === "Tab") {
        cancelRecording()
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (event.key === "Escape") {
        cancelRecording()
        return
      }

      if (CLEAR_KEYS.has(event.key) && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        clearShortcut()
        return
      }

      if (isModifierKey(event.key)) {
        return
      }

      const normalizedHotkey = keyboardEventToPageTranslationShortcut(event)

      if (!normalizedHotkey || !isValidConfiguredPageTranslationShortcut(normalizedHotkey)) {
        return
      }

      commitShortcut(normalizedHotkey)
    }

    // Settings sections remain mounted for their drafts; a hidden recorder must release the keyboard.
    const observer = new MutationObserver(() => {
      if (buttonRef.current?.closest("[hidden]"))
        cancelRecording()
    })
    let ancestor: HTMLElement | null = buttonRef.current
    while (ancestor) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ["hidden"] })
      ancestor = ancestor.parentElement
    }
    document.addEventListener("keydown", handleKeydown, true)
    return () => {
      observer.disconnect()
      document.removeEventListener("keydown", handleKeydown, true)
    }
  }, [cancelRecording, clearShortcut, commitShortcut, inRecording])

  const shortcutKey = optimisticShortcut !== null && optimisticShortcut !== initialShortcutKey
    ? optimisticShortcut
    : initialShortcutKey
  const displayedKeys = shortcutKey.trim().split("+").filter(Boolean).map(key => formatPageTranslationShortcut(key))

  return (
    <button
      ref={buttonRef}
      type="button"
      id={id}
      className={cn("shortcut-key-button group inline-flex min-h-9 max-w-full cursor-pointer flex-wrap items-center justify-end gap-1 rounded-md border-0 bg-transparent py-1 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:ring-offset-4 focus-visible:ring-offset-card", className)}
      aria-pressed={inRecording}
      aria-describedby={descriptionId}
      data-recording={inRecording}
      data-shortcut={shortcutKey}
      onClick={startRecord}
      onBlur={handleBlur}
    >
      <span id={descriptionId} className="sr-only" aria-live="polite">
        {inRecording ? i18n.t("shortcutKeySelector.placeholder") : formatPageTranslationShortcut(shortcutKey) || i18n.t("shortcutKeySelector.unset")}
      </span>
      {inRecording || !displayedKeys.length
        ? (
            <span aria-hidden="true" className={cn("shortcut-keycap inline-flex h-7 min-w-[76px] items-center justify-center rounded-[5px] border px-2 text-[11px] leading-none shadow-[0_2px_0_var(--rf-border)]", inRecording ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground")}>
              {i18n.t(inRecording ? "shortcutKeySelector.placeholder" : "shortcutKeySelector.unset")}
            </span>
          )
        : displayedKeys.map(key => (
            <kbd key={key} aria-hidden="true" className="shortcut-keycap inline-flex h-7 min-w-[30px] items-center justify-center rounded-[5px] border border-border bg-secondary px-2 font-mono text-[11px] font-normal leading-none shadow-[0_2px_0_var(--rf-border)] group-hover:border-primary/40">
              {key}
            </kbd>
          ))}
    </button>
  )
}
