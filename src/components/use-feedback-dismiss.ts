import { useIsPresent } from "motion/react"
import { useEffect, useRef, useState } from "react"

/** Pause auto-dismiss while feedback is being read, used, or hidden. */
export function useFeedbackDismiss(duration: number, onDismiss: () => void, paused = false) {
  const present = useIsPresent()
  const durationRef = useRef(duration)
  const remainingRef = useRef(duration)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [visible, setVisible] = useState(() => !document.hidden)

  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])

  useEffect(() => {
    if (durationRef.current !== duration) {
      durationRef.current = duration
      remainingRef.current = duration
    }
    if (!present || !visible || hovered || focused || paused)
      return
    const started = performance.now()
    const timer = setTimeout(onDismiss, remainingRef.current)
    return () => {
      clearTimeout(timer)
      remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - started))
    }
  }, [duration, present, visible, hovered, focused, paused, onDismiss])

  return {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocusCapture: () => setFocused(true),
    onBlurCapture: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        setFocused(false)
    },
  }
}
