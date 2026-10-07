import { motion, useIsPresent, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { browser, i18n } from "#imports"

export function SiteRuleSavedNotice({ pending, undoAvailable, undone = false, error, onUndo, onManage, onDismiss }: {
  pending: boolean
  undoAvailable: boolean
  undone?: boolean
  error: string | null
  onUndo: () => void
  onManage: () => void
  onDismiss: () => void
}) {
  const isPresent = useIsPresent()
  const reducedMotion = useReducedMotion()
  const duration = undone ? 3000 : 8000
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
    if (!isPresent || !visible || hovered || focused || pending || error)
      return
    const started = performance.now()
    const timer = setTimeout(onDismiss, remainingRef.current)
    return () => {
      clearTimeout(timer)
      remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - started))
    }
  }, [duration, isPresent, visible, hovered, focused, pending, error, onDismiss])

  return (
    <motion.div
      className="site-rule-saved"
      role="status"
      aria-live="polite"
      aria-hidden={!isPresent || undefined}
      inert={!isPresent}
      initial={false}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.4, 0, 1, 1] }}
      style={{ transformOrigin: "bottom right" }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false)
      }}
    >
      <div className="site-rule-saved-heading">
        <svg className="site-rule-saved-check" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
        <strong>{i18n.t(undone ? "siteRuleAgent.undone" : "siteRuleAgent.saved")}</strong>
        <button type="button" className="site-rule-saved-close" aria-label={i18n.t("siteRuleAgent.close")} onClick={onDismiss}>×</button>
      </div>
      {!undone && (
        <div className="site-rule-saved-actions">
          <button
            type="button"
            className="site-rule-saved-undo"
            disabled={pending || !undoAvailable}
            onClick={(event) => {
              // Undo replaces this control; release focus before it is removed.
              event.currentTarget.blur()
              onUndo()
            }}
          >
            {i18n.t("siteRuleAgent.undo")}
          </button>
          <a
            className="site-rule-saved-manage"
            href={browser.runtime.getURL("/options.html?siteRulesTab=custom#reading/site-rules")}
            aria-disabled={pending || undefined}
            tabIndex={pending ? -1 : undefined}
            onClick={(event) => {
              event.preventDefault()
              if (!pending)
                onManage()
            }}
          >
            <span>{i18n.t("siteRuleAgent.viewRules")}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </a>
        </div>
      )}
      {error && <p className="site-rule-error" role="alert">{error}</p>}
    </motion.div>
  )
}
