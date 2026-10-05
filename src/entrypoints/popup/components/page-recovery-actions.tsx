import { useAtomValue } from "jotai"
import { useRef, useState } from "react"
import { i18n } from "#imports"
import { featureProviderConfigAtom } from "@/utils/atoms/provider"
import { sendMessage } from "@/utils/message"
import { activeTabAtom, translationProgressAtom } from "../atoms"

export function PageRecoveryActions() {
  const tab = useAtomValue(activeTabAtom)
  const progress = useAtomValue(translationProgressAtom)
  const provider = useAtomValue(featureProviderConfigAtom("translate"))
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const run = async (retryOnly: boolean) => {
    if (pendingRef.current || tab.id === null)
      return
    pendingRef.current = true
    setPending(true)
    setFailed(false)
    try {
      if (!retryOnly)
        await sendMessage("clearPageTranslationCache", { tabId: tab.id, url: tab.url })
      await sendMessage("refreshPageTranslation", { url: tab.url, failedOnly: retryOnly }, tab.id)
    }
    catch {
      setFailed(true)
    }
    finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  const disabled = pending || !tab.translatable || !provider?.apiKey?.trim()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-[12px] leading-5">
        {(progress?.failed ?? 0) > 0 && (
          <button type="button" disabled={disabled} onClick={() => void run(true)} className="rounded text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60">
            {i18n.t(pending ? "popup.recovery.pending" : "popup.recovery.retryFailed")}
          </button>
        )}
        <button type="button" disabled={disabled} onClick={() => void run(false)} title={i18n.t("popup.recovery.retranslateDescription")} className="rounded text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60">
          {i18n.t(pending ? "popup.recovery.pending" : "popup.recovery.retranslate")}
        </button>
      </div>
      {failed && <p role="alert" className="text-[11px] text-destructive">{i18n.t("popup.recovery.failed")}</p>}
    </div>
  )
}
