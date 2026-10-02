import type { SubtitlePosition } from "@/types/config/subtitle-style"
import { clampSubtitlePosition } from "./appearance"

interface DragOptions {
  videoRect: () => DOMRect
  position: () => SubtitlePosition
  move: (position: SubtitlePosition) => void
  commit: (position: SubtitlePosition) => void
}

export function bindSubtitleDrag(element: HTMLElement, options: DragOptions): () => void {
  let drag: { id: number, x: number, y: number, origin: SubtitlePosition, moved: boolean } | null = null
  const clamp = (position: SubtitlePosition) => clampSubtitlePosition(position, options.videoRect(), element.getBoundingClientRect())
  const finish = (cancel: boolean) => {
    const state = drag
    if (!state)
      return
    drag = null
    element.classList.remove("dragging")
    if (element.hasPointerCapture?.(state.id))
      element.releasePointerCapture(state.id)
    if (state.moved) {
      if (cancel)
        options.move(state.origin)
      else
        options.commit(options.position())
    }
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag || (event.target instanceof Element && event.target.closest("button, select, input")))
      return
    event.preventDefault()
    event.stopPropagation()
    element.focus({ preventScroll: true })
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: options.position(), moved: false }
    element.setPointerCapture?.(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id)
      return
    const rect = options.videoRect()
    if (rect.width <= 0 || rect.height <= 0)
      return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 4)
      return
    drag.moved = true
    element.classList.add("dragging")
    event.preventDefault()
    event.stopPropagation()
    options.move(clamp({ x: drag.origin.x + dx / rect.width * 100, y: drag.origin.y + dy / rect.height * 100 }))
  }
  const up = (event: PointerEvent) => {
    if (event.pointerId === drag?.id) {
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
  }
  const cancel = () => finish(true)
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && drag) {
      event.preventDefault()
      event.stopPropagation()
      cancel()
      return
    }
    if (event.target !== element)
      return
    const step = event.shiftKey ? 10 : 2
    const deltas: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const delta = deltas[event.key]
    if (!delta)
      return
    event.preventDefault()
    event.stopPropagation()
    const position = options.position()
    const next = clamp({ x: position.x + delta[0], y: position.y + delta[1] })
    options.move(next)
    options.commit(next)
  }
  // This layer lives outside the native player; its controls must not bubble to it.
  const click = (event: MouseEvent) => event.stopPropagation()
  element.addEventListener("pointerdown", down)
  element.addEventListener("pointermove", move)
  element.addEventListener("pointerup", up)
  element.addEventListener("pointercancel", cancel)
  element.addEventListener("lostpointercapture", cancel)
  element.addEventListener("keydown", keydown)
  element.addEventListener("click", click)
  return () => {
    cancel()
    element.removeEventListener("pointerdown", down)
    element.removeEventListener("pointermove", move)
    element.removeEventListener("pointerup", up)
    element.removeEventListener("pointercancel", cancel)
    element.removeEventListener("lostpointercapture", cancel)
    element.removeEventListener("keydown", keydown)
    element.removeEventListener("click", click)
  }
}
