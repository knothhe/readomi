import { useCallback, useEffect, useRef, useState } from "react"
import { i18n } from "#imports"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { translateNodesBilingualMode, translateNodeTranslationOnlyMode } from "@/utils/host/translate/node-manipulation"
import { registerFailedTranslation } from "@/utils/host/translate/retry-failed"
import { trackTranslationRetry } from "@/utils/host/translate/ui/translation-progress"
import { getHostConfig } from "@/utils/site-rules/preview-config"

export function RetryButton({ nodes }: { nodes: ChildNode[] }) {
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const handleRetry = useCallback(async (signal?: AbortSignal) => {
    if (pendingRef.current)
      return
    pendingRef.current = true
    setPending(true)
    try {
      const pageUrl = window.location.href
      const config = await getHostConfig()
      if (signal?.aborted || !config || window.location.href !== pageUrl || !nodes.length || nodes.some(node => !node.isConnected))
        return
      const translationMode = config.translate.mode
      const walkId = getRandomUUID()
      trackTranslationRetry()
      if (translationMode === "bilingual") {
        await translateNodesBilingualMode(nodes, walkId, config, false, false, signal)
      }
      else if (translationMode === "translationOnly") {
        await translateNodeTranslationOnlyMode(nodes, walkId, config, false, signal)
      }
    }
    finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [nodes])
  useEffect(() => registerFailedTranslation(handleRetry), [handleRetry])

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => void handleRetry()}
      className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
    >
      {i18n.t("translation.retry")}
    </button>
  )
}
