import { useAtomValue, useSetAtom } from "jotai"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configAtom, setSiteDisabledAtom } from "@/utils/atoms/config"
import { isSiteDisabled, siteHostname } from "@/utils/site-disable"
import { activeTabAtom } from "../atoms"

export function SiteDisableControl({ onSavingChange }: { onSavingChange?: (saving: { url: string, disabled: boolean } | null) => void }) {
  const { url } = useAtomValue(activeTabAtom)
  const config = useAtomValue(configAtom)
  const setDisabled = useSetAtom(setSiteDisabledAtom)
  const id = useId()
  const hostname = siteHostname(url)
  const disabled = isSiteDisabled(url, config)
  const [save, setSave] = useState<{ url: string, checked: boolean, status: "saving" | "failed" } | null>(null)
  const busy = save?.url === url && save.status === "saving"
  const failed = save?.url === url && save.status === "failed"
  const title = hostname ? `${hostname}\n${i18n.t("popup.siteDisable.description")}` : i18n.t("popup.siteDisable.unavailable")
  const status = failed
    ? i18n.t("popup.siteDisable.failed")
    : !hostname ? i18n.t("popup.siteDisable.unavailable") : null

  const change = async (next: boolean) => {
    if (!hostname || busy)
      return
    setSave({ url, checked: disabled, status: "saving" })
    onSavingChange?.({ url, disabled })
    try {
      await setDisabled({ url, disabled: next })
      setSave(current => current?.url === url ? null : current)
    }
    catch {
      setSave(current => current?.url === url ? { ...current, status: "failed" } : current)
    }
    finally {
      onSavingChange?.(null)
    }
  }

  return (
    <section className="popup-site-control flex min-w-0 flex-col" aria-busy={busy || undefined}>
      <div className="flex min-h-[42px] items-center justify-between gap-3">
        <label htmlFor={id} title={title} className="flex min-h-[42px] flex-1 cursor-pointer items-center text-[13px] leading-[18px]">{i18n.t("popup.siteDisable.label")}</label>
        <Switch
          className="popup-switch"
          id={id}
          title={title}
          aria-label={i18n.t("popup.siteDisable.label")}
          aria-describedby={`${id}-description${status ? ` ${id}-status` : ""}`}
          checked={busy ? save.checked : disabled}
          disabled={!hostname || busy}
          onCheckedChange={next => void change(next)}
        />
      </div>
      <span id={`${id}-description`} className="sr-only">{title}</span>
      {status && <p id={`${id}-status`} role="status" className={`text-[11px] leading-4 ${failed ? "text-destructive" : "text-muted-foreground"}`}>{status}</p>}
    </section>
  )
}
