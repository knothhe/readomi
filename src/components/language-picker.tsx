import type { ReactNode } from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { IconCheck } from "@/components/icons"
import { cn } from "@/utils/styles/utils"

export interface PickerItem<V extends string = string> {
  value: V
  label: string
  /** Extra text the search also matches. */
  keywords?: string
  badge?: ReactNode
  separatorAfter?: boolean
}

interface LanguagePickerProps<V extends string> {
  items: PickerItem<V>[]
  value: V | null
  onChange: (value: V) => void
  /** The trigger; it receives `onClick` and the aria attributes through `renderTrigger`. */
  renderTrigger: (props: { "onClick": () => void, "aria-expanded": boolean, "aria-haspopup": "listbox", "aria-controls": string | undefined }) => ReactNode
  searchPlaceholder: string
  emptyText: string
  /** The panel is positioned by the nearest `relative` ancestor; this class sets its box. */
  panelClassName?: string
}

function matches<V extends string>(item: PickerItem<V>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q)
    return true
  return item.label.toLowerCase().includes(q) || (item.keywords?.toLowerCase().includes(q) ?? false) || item.value.toLowerCase().includes(q)
}

/**
 * A searchable list that opens under its trigger: type to filter, arrows to
 * move, Enter to pick, Escape or a click elsewhere to close.
 */
export function LanguagePicker<V extends string>({ items, value, onChange, renderTrigger, searchPlaceholder, emptyText, panelClassName }: LanguagePickerProps<V>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const visible = useMemo(() => items.filter(item => matches(item, query)), [items, query])

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setQuery("")
    setHighlighted(Math.max(items.findIndex(item => item.value === value), 0))
    setOpen(true)
  }

  const search = (next: string) => {
    setQuery(next)
    setHighlighted(0)
  }

  useEffect(() => {
    if (!open)
      return
    inputRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node))
        setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    const observer = new MutationObserver(() => {
      if (rootRef.current?.closest("[hidden]"))
        setOpen(false)
    })
    let ancestor = rootRef.current?.parentElement
    while (ancestor) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ["hidden"] })
      ancestor = ancestor.parentElement
    }
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      observer.disconnect()
    }
  }, [open])

  useEffect(() => {
    if (!open)
      return
    rootRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [highlighted, open])

  const pick = (item: PickerItem<V>) => {
    onChange(item.value)
    setOpen(false)
    rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        setHighlighted(index => Math.min(index + 1, visible.length - 1))
        break
      case "ArrowUp":
        event.preventDefault()
        setHighlighted(index => Math.max(index - 1, 0))
        break
      case "Enter":
        event.preventDefault()
        if (visible[highlighted])
          pick(visible[highlighted])
        break
      case "Escape":
        event.preventDefault()
        setOpen(false)
        rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
        break
    }
  }

  return (
    <div ref={rootRef} className="contents">
      {renderTrigger({ "onClick": toggle, "aria-expanded": open, "aria-haspopup": "listbox", "aria-controls": open ? listId : undefined })}
      {open && (
        <div className={cn("absolute z-50 flex flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-[readomi-fade-in_100ms_ease-out]", panelClassName)}>
          <input
            ref={inputRef}
            role="combobox"
            aria-controls={listId}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={visible[highlighted] ? `${listId}-${highlighted}` : undefined}
            value={query}
            onChange={event => search(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            className="m-1 h-8 rounded-md border border-input/30 bg-input/30 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          />
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto overscroll-contain p-1">
            {visible.length === 0 && <li className="py-2 text-center text-sm text-muted-foreground">{emptyText}</li>}
            {visible.map((item, index) => (
              <li
                key={item.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={item.value === value}
                data-index={index}
                data-value={item.value}
                onPointerMove={() => setHighlighted(index)}
                onClick={() => pick(item)}
                className={cn(
                  "relative flex cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-1.5 text-sm select-none",
                  index === highlighted && "bg-accent text-accent-foreground",
                  item.separatorAfter && "mb-1.5 border-b border-border pb-2",
                )}
              >
                <span className="truncate">{item.label}</span>
                {item.badge}
                {item.value === value && <IconCheck className="absolute right-2 size-4" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
