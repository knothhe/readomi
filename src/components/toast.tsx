import { AnimatePresence } from "motion/react"
import { useCallback, useSyncExternalStore } from "react"
import { i18n } from "#imports"
import { BrandIcon } from "@/components/brand-icon"
import { CornerFade } from "@/components/corner-fade"
import { useFeedbackDismiss } from "@/components/use-feedback-dismiss"
import { APP_NAME } from "@/utils/constants/app"
import { NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"

/**
 * Toasts are a module-level list any code can append to; every React root
 * that renders <Toasts /> shows them. In the content script the root lives
 * in a shadow host, so page styles never touch them.
 */

export interface ToastItem {
  id: number
  kind: "success" | "error"
  message: string
  description?: string
  durationMs: number
}

const DEFAULT_DURATION_MS = 4000
const listeners = new Set<(items: ToastItem[]) => void>()
let items: ToastItem[] = []
let nextId = 1

function publish(next: ToastItem[]) {
  items = next
  for (const listener of listeners)
    listener(items)
}

function show(kind: ToastItem["kind"], message: string, options?: { description?: string, durationMs?: number }) {
  const item: ToastItem = { id: nextId++, kind, message, description: options?.description, durationMs: options?.durationMs ?? DEFAULT_DURATION_MS }
  publish([...items, item])
  return item.id
}

export function dismiss(id: number) {
  if (items.some(item => item.id === id))
    publish(items.filter(item => item.id !== id))
}

export const toast = {
  success: (message: string, options?: { description?: string, durationMs?: number }) => show("success", message, options),
  error: (message: string, options?: { description?: string, durationMs?: number }) => show("error", message, options),
}

function subscribe(listener: (items: ToastItem[]) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size)
      items = []
  }
}

function useToasts() {
  return useSyncExternalStore(subscribe, () => items, () => items)
}

function ToastCard({ item }: { item: ToastItem }) {
  const onDismiss = useCallback(() => dismiss(item.id), [item.id])
  const interaction = useFeedbackDismiss(item.durationMs, onDismiss)
  return (
    <CornerFade
      role={item.kind === "error" ? "alert" : "status"}
      className="readomi-toast-card"
      {...interaction}
    >
      <BrandIcon className="mt-px size-[22px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className={item.kind === "error" ? "font-medium text-destructive" : "font-medium"}>{item.message}</div>
        {item.description && <div className="mt-0.5 text-xs text-muted-foreground">{item.description}</div>}
      </div>
      <button
        type="button"
        aria-label={i18n.t("siteRuleAgent.close")}
        onClick={onDismiss}
        className="readomi-toast-close"
      >
        ×
      </button>
    </CornerFade>
  )
}

export function Toasts({ embedded = false }: { embedded?: boolean }) {
  const current = useToasts()
  // Keep AnimatePresence mounted when the last toast leaves.
  const stack = (
    <div role="region" aria-label={`${APP_NAME} notifications`} className={`${NOTRANSLATE_CLASS} readomi-toast-stack`}>
      <AnimatePresence>
        {current.map(item => <ToastCard key={item.id} item={item} />)}
      </AnimatePresence>
    </div>
  )
  return embedded ? stack : <div className="readomi-corner-dock">{stack}</div>
}
