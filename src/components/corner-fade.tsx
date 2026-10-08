import type { HTMLMotionProps } from "motion/react"
import { motion, useIsPresent, useReducedMotion } from "motion/react"

/** The shared opacity-only entrance and exit for all corner feedback. */
export function CornerFade(props: HTMLMotionProps<"div">) {
  const present = useIsPresent()
  const reduced = useReducedMotion()
  return (
    <motion.div
      {...props}
      aria-hidden={!present || undefined}
      inert={!present}
      initial={{ opacity: reduced ? 1 : 0 }}
      animate={{ opacity: 1, transition: { duration: reduced ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] } }}
      exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.16, ease: [0.4, 0, 1, 1] } }}
    />
  )
}
