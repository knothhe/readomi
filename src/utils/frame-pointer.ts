export interface PointerSample {
  x: number
  y: number
  time: number
  topCoordinates: boolean
}

declare global {
  interface Window {
    __READOMI_POINTER_INSIDE__?: boolean
    __READOMI_TOP_MOUSE_EVENT__?: MouseEvent
    __READOMI_POINTER__?: PointerSample
    __READOMI_HIT_POINTER__?: typeof hitPointer
    __READOMI_HOVER_GESTURE__?: (hotkey: string, point?: PointerSample) => void
  }
}

// Map through same-origin embedding documents, including parked siblings.
function embeddingFrames() {
  const frames: HTMLElement[] = []
  let view: Window = window
  while (view !== view.top) {
    const frame = view.frameElement
    if (!frame)
      return null
    frames.push(frame as HTMLElement)
    view = view.parent
  }
  return frames
}

function deepHit(doc: Document, x: number, y: number) {
  let hit = doc.elementFromPoint(x, y)
  while (hit?.shadowRoot && !hit.hasAttribute("data-readomi-inline-preview")) {
    const child = hit.shadowRoot.elementFromPoint(x, y)
    if (!child || child === hit)
      break
    hit = child
  }
  return hit
}

export function hoveredLeaf() {
  let leaf = Array.from(document.querySelectorAll(":hover")).at(-1)
  while (leaf?.shadowRoot && !leaf.hasAttribute("data-readomi-inline-preview")) {
    const child = Array.from(leaf.shadowRoot.querySelectorAll(":hover")).at(-1)
    if (!child)
      break
    leaf = child
  }
  return leaf && !leaf.matches("iframe,html,body") ? leaf : null
}

function geometry(frame: HTMLElement) {
  const rect = frame.getBoundingClientRect()
  const style = frame.ownerDocument.defaultView!.getComputedStyle(frame)
  const sx = rect.width / frame.offsetWidth
  const sy = rect.height / frame.offsetHeight
  return {
    sx, sy,
    left: rect.left + sx * (frame.clientLeft + Number.parseFloat(style.paddingLeft)),
    top: rect.top + sy * (frame.clientTop + Number.parseFloat(style.paddingTop)),
  }
}

export function samplePointer(event: MouseEvent) {
  if (!event.isTrusted)
    return
  window.__READOMI_POINTER_INSIDE__ = event.type !== "mouseout"
  if (window === window.top) {
    window.__READOMI_TOP_MOUSE_EVENT__ = event
    return
  }
  let x = event.clientX
  let y = event.clientY
  const frames = embeddingFrames()
  for (const frame of frames ?? []) {
    const box = geometry(frame)
    x = box.left + x * box.sx
    y = box.top + y * box.sy
  }
  window.__READOMI_POINTER__ = { x, y, time: performance.timeOrigin + event.timeStamp, topCoordinates: !!frames }
}

export function hitPointer(sample: PointerSample) {
  let { x, y } = sample
  if (sample.topCoordinates) {
    const frames = embeddingFrames()
    if (!frames)
      return null
    if (frames.length && frames.every(frame => frame.matches(":hover"))) {
      const hovered = hoveredLeaf()
      if (hovered)
        return hovered
    }
    for (const frame of frames.reverse()) {
      if (deepHit(frame.ownerDocument, x, y) !== frame)
        return null
      const box = geometry(frame)
      x = (x - box.left) / box.sx
      y = (y - box.top) / box.sy
    }
  }
  const element = deepHit(document, x, y)
  return element?.matches("iframe,html,body") ? null : element
}
