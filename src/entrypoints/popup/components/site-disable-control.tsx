import { useAtomValue, useSetAtom } from "jotai"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configAtom, setSiteDisabledAtom } from "@/utils/atoms/config"
import { isSiteDisabled, siteHostname } from "@/utils/site-disable"
import { activeTabAtom } from "../atoms"

export function SiteDisableControl() {
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
  const status = busy
    ? i18n.t("popup.siteDisable.saving")
    : failed
      ? i18n.t("popup.siteDisable.failed")
      : !hostname ? i18n.t("popup.siteDisable.unavailable") : disabled ? i18n.t("popup.siteDisable.disabled") : null

  const change = async (next: boolean) => {
    if (!hostname || busy)
      return
    setSave({ url, checked: disabled, status: "saving" })
    try {
      await setDisabled({ url, disabled: next })
      setSave(current => current?.url === url ? null : current)
    }
    catch {
      setSave(current => current?.url === url ? { ...current, status: "failed" } : current)
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-1 px-0.5 pt-2.5" aria-busy={busy || undefined}>
      <div className="flex min-h-6 items-center justify-between gap-2.5">
        <label htmlFor={id} title={title} className="text-[13px] leading-[18px]">{i18n.t("popup.siteDisable.label")}</label>
        <Switch
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
      {status && <p id={`${id}-status`} role="status" className={busy ? "sr-only" : `text-[11px] leading-4 ${failed ? "text-destructive" : "text-muted-foreground"}`}>{status}</p>}
    </section>
  )
}
