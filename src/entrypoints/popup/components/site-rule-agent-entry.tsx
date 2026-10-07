import { useAtomValue } from "jotai"
import { useState } from "react"
import { i18n } from "#imports"
import { sendMessage } from "@/utils/message"
import { activeTabAtom } from "../atoms"
import { PopupHelpAction } from "./popup-help-action"
import { PopupStateFade } from "./popup-state-fade"

export function SiteRuleAgentEntry({ disabled = false }: { disabled?: boolean }) {
  const tab = useAtomValue(activeTabAtom)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const supported = tab.id !== null && /^https?:/i.test(tab.url)

  const open = async () => {
    if (disabled || !supported || pending)
      return
    setPending(true)
    setFailed(false)
    try {
      await sendMessage("openSiteRulePanel", undefined, tab.id!)
      window.close()
    }
    catch {
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <PopupStateFade paused={disabled} className="flex flex-col gap-1.5">
      <PopupHelpAction
        indicator="external"
        disabled={disabled || !supported || pending}
        title={supported ? undefined : i18n.t("siteRuleAgent.unsupported")}
        onClick={() => void open()}
      >
        {i18n.t("siteRuleAgent.entry")}
      </PopupHelpAction>
      {failed && <p role="alert" className="text-[11px] leading-4 text-destructive">{i18n.t("siteRuleAgent.openFailed")}</p>}
    </PopupStateFade>
  )
}
