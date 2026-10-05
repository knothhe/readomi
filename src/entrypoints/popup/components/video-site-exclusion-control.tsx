import { useAtomValue, useSetAtom } from "jotai"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap, setVideoSiteExclusionAtom } from "@/utils/atoms/config"
import { openOptionsPage } from "@/utils/navigation"
import { isVideoTranslationExcluded, normalizeVideoSiteRule, videoDomainRuleForUrl } from "@/utils/subtitles/video-site-rules"
import { activeTabAtom } from "../atoms"

function displayHostname(url: string): string {
  try {
    return new URL(url).hostname || "—"
  }
  catch {
    return "—"
  }
}

export function VideoSiteExclusionControl() {
  const { url } = useAtomValue(activeTabAtom)
  const { videoExcludedSites: rules } = useAtomValue(configFieldsAtomMap.features)
  const setExcluded = useSetAtom(setVideoSiteExclusionAtom)
  const id = useId()
  const descriptionId = `${id}-description`
  const statusId = `${id}-status`
  const domain = videoDomainRuleForUrl(url)
  const hostname = domain?.value ?? displayHostname(url)
  const excluded = isVideoTranslationExcluded(url, rules)
  const managed = !!domain && isVideoTranslationExcluded(url, rules.filter((rule) => {
    const normalized = normalizeVideoSiteRule(rule)
    return normalized?.type !== "domain" || normalized.value !== domain.value
  }))
  const [save, setSave] = useState<{ url: string, checked: boolean, status: "saving" | "failed" } | null>(null)
  const busy = save?.url === url && save.status === "saving"
  const failed = save?.url === url && save.status === "failed"
  const scope = i18n.t("popup.videoSiteExclusion.description")
  const title = `${hostname}\n${scope}`
  const status = busy
    ? i18n.t("popup.videoSiteExclusion.saving")
    : failed
      ? i18n.t("videoSiteRules.saveFailed")
      : !domain
          ? i18n.t("popup.videoSiteExclusion.unavailable")
          : managed ? i18n.t("popup.videoSiteExclusion.managed") : null

  const change = async (next: boolean) => {
    if (!domain || busy || managed)
      return
    setSave({ url, checked: excluded, status: "saving" })
    try {
      await setExcluded({ url, excluded: next })
      setSave(current => current?.url === url ? null : current)
    }
    catch {
      setSave(current => current?.url === url ? { ...current, status: "failed" } : current)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1 px-0.5" aria-busy={busy || undefined}>
      <div className="flex min-h-6 items-center justify-between gap-2.5">
        <label htmlFor={id} title={title} className="text-[13px] leading-[18px]">{i18n.t("popup.videoSiteExclusion.label")}</label>
        <Switch
          id={id}
          title={title}
          aria-label={i18n.t("popup.videoSiteExclusion.label")}
          aria-describedby={status ? `${descriptionId} ${statusId}` : descriptionId}
          aria-busy={busy || undefined}
          checked={busy ? save.checked : excluded}
          disabled={!domain || busy || managed}
          onCheckedChange={next => void change(next)}
        />
      </div>
      <span id={descriptionId} className="sr-only">{title}</span>
      {status && (
        <p id={statusId} role={busy || failed ? "status" : undefined} className={busy ? "sr-only" : `text-[11px] leading-4 ${failed ? "text-destructive" : "text-muted-foreground"}`}>
          {status}
          {managed && (
            <button
              type="button"
              className="ml-1.5 rounded text-brand whitespace-nowrap outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => void openOptionsPage({ section: "features" })}
            >
              {i18n.t("popup.videoSiteExclusion.manage")}
            </button>
          )}
        </p>
      )}
    </div>
  )
}
