import { useAtomValue } from "jotai"
import { useEffect, useRef, useState } from "react"
import { i18n } from "#imports"
import { IconCheck, IconTrash } from "@/components/icons"
import { sendMessage } from "@/utils/message"
import { cn } from "@/utils/styles/utils"
import { activeTabAtom } from "../atoms"

const labels = {
  idle: "popup.clearTranslationCache.label",
  pending: "popup.clearTranslationCache.clearing",
  success: "popup.clearTranslationCache.cleared",
  error: "popup.clearTranslationCache.failed",
} as const

export function ClearTranslationCacheButton() {
  const tab = useAtomValue(activeTabAtom)
  const [state, setState] = useState<keyof typeof labels>("idle")
  const pendingRef = useRef(false)

  useEffect(() => {
    if (state !== "success" && state !== "error")
      return
    const timer = setTimeout(setState, 3000, "idle")
    return () => clearTimeout(timer)
  }, [state])

  const clear = async () => {
    if (pendingRef.current || tab.id === null || !tab.translatable)
      return
    pendingRef.current = true
    setState("pending")
    try {
      await sendMessage("clearPageTranslationCache", { tabId: tab.id, url: tab.url })
      setState("success")
    }
    catch {
      setState("error")
    }
    finally {
      pendingRef.current = false
    }
  }

  return (
    <button
      type="button"
      title={i18n.t(state === "idle" ? "popup.clearTranslationCache.description" : labels[state])}
      aria-label={i18n.t(labels[state])}
      aria-busy={state === "pending"}
      disabled={state === "pending" || tab.id === null || !tab.translatable}
      onClick={() => void clear()}
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60", state === "error" && "text-destructive")}
    >
      {state === "success" ? <IconCheck aria-hidden="true" className="size-4 text-success" stroke={1.75} /> : <IconTrash aria-hidden="true" className={cn("size-4", state === "pending" && "animate-pulse")} stroke={1.75} />}
      {state !== "idle" && <span className="sr-only" role="status">{i18n.t(labels[state])}</span>}
    </button>
  )
}
