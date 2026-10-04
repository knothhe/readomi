import { useAtomValue } from "jotai"
import { useState } from "react"
import { i18n } from "#imports"
import { sendMessage } from "@/utils/message"
import { activeTabAtom } from "../atoms"

export function SiteRuleAgentEntry() {
  const tab = useAtomValue(activeTabAtom)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const supported = tab.id !== null && /^https?:/i.test(tab.url)

  const open = async () => {
    if (!supported || pending)
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
    <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
      <button
        type="button"
        className="text-left text-[12px] leading-5 text-muted-foreground hover:text-primary disabled:opacity-50"
        disabled={!supported || pending}
        title={supported ? undefined : i18n.t("siteRuleAgent.unsupported")}
        onClick={() => void open()}
      >
        {i18n.t("siteRuleAgent.entry")}
        <span aria-hidden="true"> ↗</span>
      </button>
      {failed && <p role="alert" className="text-[11px] leading-4 text-destructive">{i18n.t("siteRuleAgent.openFailed")}</p>}
    </div>
  )
}
