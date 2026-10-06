import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react"
import type { ProviderConfig } from "@/types/config/provider"
import type { MoveProviderAction } from "@/utils/service-management"
import { useSetAtom } from "jotai"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { i18n } from "#imports"
import { moveProviderAtom } from "@/utils/atoms/service"

interface PointerSort {
  id: string
  pointerId: number
  startX: number
  startY: number
  offsetY: number
  rect: DOMRect
  original: string[]
  order: string[]
  moved: boolean
  target: HTMLDivElement
}
interface DragPreview { id: string, top: number, left: number, width: number, height: number }

function move(order: string[], id: string, index: number) {
  const next = order.filter(candidate => candidate !== id)
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id)
  return next
}

/** A local drag preview; persistence moves one service in the latest stored config. */
export function SortableServiceList({ providers, children }: { providers: ProviderConfig[], children: (provider: ProviderConfig) => ReactNode }) {
  const persist = useSetAtom(moveProviderAtom)
  const listRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<PointerSort | null>(null)
  const keyboardRef = useRef<{ id: string, original: string[], order: string[] } | null>(null)
  const savingRef = useRef(false)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [drag, setDrag] = useState<DragPreview | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<MoveProviderAction | null>(null)
  const ids = providers.map(provider => provider.id)
  const signature = JSON.stringify(ids)
  const ordered = draft ? [...draft.flatMap(id => providers.filter(provider => provider.id === id)), ...providers.filter(provider => !draft.includes(provider.id))] : providers

  const cancel = () => {
    const session = pointerRef.current
    pointerRef.current = null
    if (session?.target.hasPointerCapture?.(session.pointerId))
      session.target.releasePointerCapture(session.pointerId)
    keyboardRef.current = null
    setPicked(null)
    setDrag(null)
    setDraft(null)
  }

  // External removal/reordering invalidates an in-progress gesture, never a storage write.
  useEffect(() => {
    if (!pointerRef.current && !keyboardRef.current)
      return
    const frame = requestAnimationFrame(cancel)
    return () => cancelAnimationFrame(frame)
  }, [signature])

  useLayoutEffect(() => {
    if (keyboardRef.current) {
      const item = Array.from(listRef.current!.querySelectorAll<HTMLElement>(".settings-service-sort-item")).find(item => item.dataset.serviceId === keyboardRef.current?.id)
      item?.querySelector<HTMLButtonElement>(".settings-service-drag-handle")?.focus()
    }
  }, [draft])

  const isDragging = !!drag
  useEffect(() => {
    if (!isDragging)
      return
    const original = document.body.style.userSelect
    document.body.style.userSelect = "none"
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape")
        cancel()
    }
    window.addEventListener("keydown", escape)
    window.addEventListener("blur", cancel)
    return () => {
      document.body.style.userSelect = original
      window.removeEventListener("keydown", escape)
      window.removeEventListener("blur", cancel)
    }
  }, [isDragging])

  const save = async (action: MoveProviderAction) => {
    if (savingRef.current)
      return
    savingRef.current = true
    setSaving(true)
    setFailure(null)
    try {
      await persist(action)
    }
    catch {
      setFailure(action)
    }
    finally {
      setDraft(null)
      savingRef.current = false
      setSaving(false)
    }
  }

  const finish = (id: string, original: string[], order: string[]) => {
    pointerRef.current = null
    keyboardRef.current = null
    setDrag(null)
    setPicked(null)
    if (order.every((candidate, index) => candidate === original[index])) {
      setDraft(null)
      return
    }
    void save({ providerId: id, beforeId: order[order.indexOf(id) + 1] ?? null })
  }

  const startPointer = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary || savingRef.current || providers.length < 2)
      return
    cancel()
    const content = event.currentTarget.closest(".settings-service-sort-content")!
    const rect = content.getBoundingClientRect()
    listRef.current!.setPointerCapture(event.pointerId)
    pointerRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetY: event.clientY - rect.top, rect, original: ids, order: ids, moved: false, target: listRef.current! }
    event.currentTarget.focus()
  }

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const session = pointerRef.current
    if (!session || event.pointerId !== session.pointerId)
      return
    if (!session.moved && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 4)
      return
    event.preventDefault()
    session.moved = true
    const others = Array.from(listRef.current!.querySelectorAll<HTMLElement>(".settings-service-sort-item"))
      .filter(item => item.dataset.serviceId !== session.id)
    const index = others.filter(item => event.clientY > item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2).length
    session.order = move(session.order, session.id, index)
    setDraft(session.order)
    setDrag({ id: session.id, top: event.clientY - session.offsetY, left: session.rect.left + (window.innerWidth <= 600 ? 5 : 12), width: session.rect.width, height: session.rect.height })
    if (event.clientY < 60)
      window.scrollBy(0, -12)
    else if (event.clientY > window.innerHeight - 60)
      window.scrollBy(0, 12)
  }

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    const session = pointerRef.current
    if (!session || event.pointerId !== session.pointerId)
      return
    finish(session.id, session.original, session.order)
    if (event.currentTarget.hasPointerCapture(session.pointerId))
      event.currentTarget.releasePointerCapture(session.pointerId)
  }

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (savingRef.current || providers.length < 2)
      return
    if (event.key === "Escape") {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      if (keyboardRef.current?.id === id) {
        const session = keyboardRef.current
        finish(id, session.original, session.order)
      }
      else {
        cancel()
        keyboardRef.current = { id, original: ids, order: ids }
        setPicked(id)
        setDraft(ids)
      }
      return
    }
    const session = keyboardRef.current
    if (session?.id !== id || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
      return
    event.preventDefault()
    const index = session.order.indexOf(id)
    const next = event.key === "Home" ? 0 : event.key === "End" ? session.order.length - 1 : index + (event.key === "ArrowUp" ? -1 : 1)
    session.order = move(session.order, id, next)
    setDraft(session.order)
  }

  return (
    <>
      <div
        ref={listRef}
        className="settings-service-list"
        role="radiogroup"
        aria-label={i18n.t("options.service.listLabel")}
        data-saving={saving}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={cancel}
        onLostPointerCapture={() => pointerRef.current && cancel()}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLButtonElement) || event.target.getAttribute("role") !== "radio")
            return
          event.preventDefault()
          const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[role=radio]:not(:disabled)"))
            .filter(radio => radio === event.target || radio.getAttribute("aria-disabled") !== "true")
          const index = radios.indexOf(event.target)
          const next = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1 : (index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) + radios.length) % radios.length
          radios[next]?.focus()
          radios[next]?.click()
        }}
      >
        {ordered.map((provider) => {
          const dragging = drag?.id === provider.id
          const next = ordered[ordered.findIndex(candidate => candidate.id === provider.id) + 1]
          return (
            <div key={provider.id} className="settings-service-sort-item" data-service-id={provider.id} data-dragging={dragging} data-picked={picked === provider.id} style={dragging ? { height: drag.height } : undefined}>
              {dragging && <span className="settings-service-drop-label">{next ? i18n.t("options.service.order.before", [next.name]) : i18n.t("options.service.order.end")}</span>}
              <div className="settings-service-sort-content" style={dragging ? { position: "fixed", top: drag.top, left: drag.left, width: drag.width } as CSSProperties : undefined}>
                <button
                  type="button"
                  className="settings-service-drag-handle"
                  aria-label={i18n.t("options.service.order.handle", [provider.name])}
                  aria-describedby={picked === provider.id ? "service-order-keyboard" : undefined}
                  title={i18n.t(saving ? "options.service.order.locked" : "options.service.order.hint")}
                  disabled={saving || providers.length < 2}
                  onPointerDown={event => startPointer(event, provider.id)}
                  onKeyDown={event => onHandleKey(event, provider.id)}
                  onBlur={(event) => {
                    if (keyboardRef.current && event.relatedTarget)
                      cancel()
                  }}
                >
                  <svg viewBox="0 0 11 16" aria-hidden="true">
                    <circle cx="3" cy="3" r="1.1" />
                    <circle cx="8" cy="3" r="1.1" />
                    <circle cx="3" cy="8" r="1.1" />
                    <circle cx="8" cy="8" r="1.1" />
                    <circle cx="3" cy="13" r="1.1" />
                    <circle cx="8" cy="13" r="1.1" />
                  </svg>
                </button>
                {children(provider)}
              </div>
            </div>
          )
        })}
        {providers.length === 0 && <p className="settings-service-empty">{i18n.t("options.service.empty.title")}</p>}
      </div>
      {picked && (
        <p id="service-order-keyboard" className="settings-service-order-keyboard" role="status">
          {i18n.t("options.service.order.moving", [providers.find(provider => provider.id === picked)?.name ?? ""])}
          {" · "}
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          {i18n.t("options.service.order.adjust")}
          {" · "}
          <kbd>{i18n.t("options.service.order.space")}</kbd>
          {i18n.t("options.service.order.confirm")}
          {" · "}
          <kbd>Esc</kbd>
          {i18n.t("options.service.cancel")}
          <span className="sr-only">{i18n.t("options.service.order.position", [String(ordered.findIndex(provider => provider.id === picked) + 1), String(ordered.length)])}</span>
        </p>
      )}
      {failure && (
        <p className="settings-service-order-failure" role="alert">
          {i18n.t("options.service.order.failed")}
          <button type="button" onClick={() => void save(failure)}>{i18n.t("options.service.order.retry")}</button>
        </p>
      )}
    </>
  )
}
