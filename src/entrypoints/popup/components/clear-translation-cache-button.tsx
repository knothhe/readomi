import { useEffect, useRef, useState } from "react"
import { i18n } from "#imports"
import { sendMessage } from "@/utils/message"
import { cn } from "@/utils/styles/utils"

const labels = {
  idle: "popup.clearTranslationCache.label",
  pending: "popup.clearTranslationCache.clearing",
  success: "popup.clearTranslationCache.cleared",
  error: "popup.clearTranslationCache.failed",
} as const

export function ClearTranslationCacheButton() {
  const [state, setState] = useState<keyof typeof labels>("idle")
  const pendingRef = useRef(false)

  useEffect(() => {
    if (state !== "success" && state !== "error")
      return
    const timer = setTimeout(setState, 3000, "idle")
    return () => clearTimeout(timer)
  }, [state])

  const clear = async () => {
    if (pendingRef.current)
      return
    pendingRef.current = true
    setState("pending")
    try {
      await sendMessage("clearTranslationCache")
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
      title={i18n.t("popup.clearTranslationCache.description")}
      aria-live="polite"
      aria-busy={state === "pending"}
      disabled={state === "pending"}
      onClick={() => void clear()}
      className={cn("h-7 shrink-0 rounded-md px-1 text-[11px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60", state === "error" && "text-destructive")}
    >
      {i18n.t(labels[state])}
    </button>
  )
}
