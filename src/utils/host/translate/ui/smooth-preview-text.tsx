import type { FrameData } from "motion"
import { cancelFrame, frame } from "motion"
import { useLayoutEffect, useRef } from "react"

interface PreviewTextProps {
  content: string
  done: boolean
  onProgress?: (length: number) => void
  onComplete?: () => void
}

const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : undefined

function textBoundaries(text: string) {
  const boundaries = [0]
  const graphemes = segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text)
  for (const grapheme of graphemes)
    boundaries.push(boundaries.at(-1)! + grapheme.length)
  return boundaries
}

function createTextReveal(node: HTMLDivElement) {
  const media = node.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
  let props: PreviewTextProps = { content: "", done: false }
  let boundaries = [0]
  let progress = 0
  let scheduled = false
  let disposed = false
  let completed = false

  const write = () => {
    if (disposed)
      return
    const length = boundaries[Math.floor(progress)]
    const text = props.content.slice(0, length)
    if (node.textContent !== text) {
      node.textContent = text
      // Notify before paint so replacement mode hides the source atomically.
      props.onProgress?.(length)
    }
    if (props.done && length === props.content.length && !completed) {
      completed = true
      props.onComplete?.()
    }
  }
  const tick = ({ delta }: FrameData) => {
    if (disposed)
      return
    const target = boundaries.length - 1
    // Keep a steady baseline; accelerate a backlog so the preview catches up.
    progress = Math.min(target, progress + Math.max(40, target - progress) * delta / 1000)
    write()
    if (progress >= target) {
      cancelFrame(tick)
      scheduled = false
    }
  }
  const sync = () => {
    if (disposed)
      return
    const target = boundaries.length - 1
    if (media?.matches)
      progress = target
    write()
    if (progress < target) {
      if (!scheduled) {
        scheduled = true
        // Motion shares and batches this loop across concurrent text groups.
        // Its bounded frame delta prevents jumps after a background tab resumes.
        frame.render(tick, true)
      }
    }
    else {
      cancelFrame(tick)
      scheduled = false
    }
  }
  media?.addEventListener?.("change", sync)
  return {
    update(next: PreviewTextProps) {
      if (!next.content.startsWith(props.content))
        progress = 0
      if (next.content !== props.content || !next.done)
        completed = false
      props = next
      boundaries = textBoundaries(next.content)
      progress = Math.min(progress, boundaries.length - 1)
      sync()
    },
    dispose() {
      disposed = true
      cancelFrame(tick)
      media?.removeEventListener?.("change", sync)
    },
  }
}

export function SmoothPreviewText({ content, done, onProgress, onComplete }: PreviewTextProps) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const revealRef = useRef<ReturnType<typeof createTextReveal> | null>(null)
  useLayoutEffect(() => {
    const instance = createTextReveal(nodeRef.current!)
    revealRef.current = instance
    return () => {
      instance.dispose()
      revealRef.current = null
    }
  }, [])
  useLayoutEffect(() => {
    revealRef.current?.update({ content, done, onProgress, onComplete })
  }, [content, done, onProgress, onComplete])
  // Motion writes the text node directly, without a React render per character.
  return <div ref={nodeRef} className="group" />
}
