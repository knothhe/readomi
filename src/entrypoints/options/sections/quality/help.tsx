import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { i18n } from "#imports"

/** Help stays outside the card's clipping area and is available without a mouse. */
export function QualityHelp({ label, text }: { label: string, text: string }) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  const cancelClose = () => clearTimeout(closeTimerRef.current)
  const closeAfterLeaving = () => {
    cancelClose()
    if (document.activeElement !== buttonRef.current)
      closeTimerRef.current = setTimeout(setOpen, 150, false)
  }

  const show = () => {
    cancelClose()
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect)
      return
    const width = Math.min(320, window.innerWidth - 32)
    setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top: rect.bottom + 8 })
    setOpen(true)
  }

  useEffect(() => () => clearTimeout(closeTimerRef.current), [])

  const placeTooltip = (element: HTMLDivElement | null) => {
    tooltipRef.current = element
    const rect = element?.getBoundingClientRect()
    const anchor = buttonRef.current?.getBoundingClientRect()
    if (element && rect && anchor && rect.bottom > window.innerHeight - 16)
      element.style.top = `${Math.max(16, anchor.top - rect.height - 8)}px`
  }

  useEffect(() => {
    if (!open)
      return
    const dismiss = () => setOpen(false)
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        dismiss()
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target))
        dismiss()
    }
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !tooltipRef.current?.contains(event.target))
        dismiss()
    }
    document.addEventListener("keydown", keydown)
    document.addEventListener("pointerdown", outside)
    window.addEventListener("scroll", scroll, true)
    window.addEventListener("resize", dismiss)
    return () => {
      document.removeEventListener("keydown", keydown)
      document.removeEventListener("pointerdown", outside)
      window.removeEventListener("scroll", scroll, true)
      window.removeEventListener("resize", dismiss)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} · ${i18n.t("options.quality.help")}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={closeAfterLeaving}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={show}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        ?
      </button>
      {open && createPortal(
        <div
          ref={placeTooltip}
          id={id}
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={closeAfterLeaving}
          style={{ ...position, width: Math.min(320, window.innerWidth - 32), maxHeight: window.innerHeight - 32 }}
          className="fixed z-50 overflow-auto rounded-lg border border-border bg-card p-3 text-xs leading-relaxed whitespace-pre-line text-card-foreground shadow-lg"
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  )
}
