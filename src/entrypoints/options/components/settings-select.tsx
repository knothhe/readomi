import type { KeyboardEvent } from "react"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { IconCheck, IconChevronDown } from "@/components/icons"
import { cn } from "@/utils/styles/utils"

export interface SettingsSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SettingsSelectProps {
  "id"?: string
  "value": string
  "options": readonly SettingsSelectOption[]
  "onValueChange": (value: string) => void
  "disabled"?: boolean
  "className"?: string
  "aria-label"?: string
  "aria-labelledby"?: string
}

/** A select-only combobox. Exploring options leaves the saved value intact until a choice is confirmed. */
export function SettingsSelect({
  id,
  value,
  options,
  onValueChange,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SettingsSelectProps) {
  const generatedId = useId()
  const triggerId = id ?? generatedId
  const listId = `${generatedId}-list`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const searchRef = useRef({ text: "", time: 0 })
  const [open, setOpen] = useState(false)
  const isOpen = open && !disabled
  const [highlighted, setHighlighted] = useState(0)
  const selected = options.findIndex(option => option.value === value)
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0)

  const show = (index = selected) => {
    if (disabled || enabled.length === 0)
      return
    setHighlighted(enabled.includes(index) ? index : enabled[0])
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled)
      return
    if (option.value !== value)
      onValueChange(option.value)
    setOpen(false)
  }

  useLayoutEffect(() => {
    if (!open)
      return
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect)
        return
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const upwards = below < 180 && above > below
      const width = Math.min(Math.max(rect.width, 164), window.innerWidth - 24)
      if (menuRef.current) {
        Object.assign(menuRef.current.style, {
          position: "fixed",
          left: `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`,
          width: `${width}px`,
          maxHeight: `${Math.min(260, Math.max(60, (upwards ? above : below) - 6))}px`,
          top: upwards ? "auto" : `${rect.bottom + 6}px`,
          bottom: upwards ? `${window.innerHeight - rect.top + 6}px` : "auto",
        })
      }
    }
    update()
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node))
        update()
    }
    window.addEventListener("resize", update)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [open, options.length, disabled])

  useEffect(() => {
    if (!open)
      return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target))
        setOpen(false)
    }
    // Sections stay mounted to retain drafts. Dismiss their portalled menus when navigation hides them.
    const observer = new MutationObserver(() => {
      if (triggerRef.current?.disabled || triggerRef.current?.closest("[hidden]"))
        setOpen(false)
    })
    if (triggerRef.current)
      observer.observe(triggerRef.current, { attributes: true, attributeFilter: ["disabled"] })
    let ancestor = triggerRef.current?.parentElement
    while (ancestor) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ["hidden"] })
      ancestor = ancestor.parentElement
    }
    document.addEventListener("pointerdown", dismiss, true)
    return () => {
      observer.disconnect()
      document.removeEventListener("pointerdown", dismiss, true)
    }
  }, [open])

  useEffect(() => {
    if (open)
      menuRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [highlighted, open])

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled)
      return
    const current = enabled.indexOf(highlighted)
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault()
        if (!open) {
          show()
        }
        else if (event.altKey && event.key === "ArrowUp") {
          choose(highlighted)
        }
        else {
          const next = Math.max(0, Math.min(enabled.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))
          setHighlighted(enabled[next])
        }
        break
      }
      case "Home":
      case "End":
        event.preventDefault()
        show(event.key === "Home" ? enabled[0] : enabled[enabled.length - 1])
        break
      case "PageDown":
      case "PageUp":
        if (open) {
          event.preventDefault()
          setHighlighted(enabled[Math.max(0, Math.min(enabled.length - 1, current + (event.key === "PageDown" ? 10 : -10)))])
        }
        break
      case "Enter":
      case " ":
        event.preventDefault()
        if (open)
          choose(highlighted)
        else
          show()
        break
      case "Escape":
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
        break
      case "Tab":
        if (open)
          choose(highlighted)
        break
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const now = Date.now()
          const text = (now - searchRef.current.time < 700 ? searchRef.current.text : "") + event.key.toLocaleLowerCase()
          searchRef.current = { text, time: now }
          const query = [...text].every(character => character === text[0]) ? text[0] : text
          const start = open ? highlighted : selected
          const ordered = [...enabled.filter(index => index > start), ...enabled.filter(index => index <= start)]
          const match = ordered.find(index => options[index].label.toLocaleLowerCase().startsWith(query))
          if (match !== undefined) {
            event.preventDefault()
            show(match)
          }
        }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={isOpen ? `${listId}-${highlighted}` : undefined}
        data-value={value}
        disabled={disabled}
        className={cn("settings-select", className)}
        onClick={() => open ? setOpen(false) : show()}
        onKeyDown={keyDown}
        onBlur={() => setOpen(false)}
      >
        <span>{options[selected]?.label ?? value}</span>
        <IconChevronDown className="size-3.5 shrink-0" />
      </button>
      {isOpen && createPortal(
        <ul ref={menuRef} id={listId} role="listbox" aria-labelledby={triggerId} className="settings-select-menu">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-value={option.value}
              data-index={index}
              data-highlighted={index === highlighted || undefined}
              className="settings-select-option"
              onPointerDown={event => event.preventDefault()}
              onPointerMove={() => !option.disabled && setHighlighted(index)}
              onClick={() => choose(index)}
            >
              <span className="settings-select-check">{option.value === value && <IconCheck className="size-3.5" />}</span>
              <span>{option.label}</span>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}
