import type { SubtitleStatus } from "@/types/subtitle-status"
import { useAtom, useAtomValue } from "jotai"
import { useEffect, useId, useRef, useState } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { sendMessage } from "@/utils/message"
import { formatHotkey } from "@/utils/os"
import { activeTabAtom } from "../atoms"
import { DisplayModeControl } from "./display-mode-control"
import { TranslationControlRow } from "./translation-control-row"
import { VideoSiteExclusionControl } from "./video-site-exclusion-control"

/** Subtitle modes are edited here independently of web text, without opening Settings. */
export function VideoTranslationControl() {
  const tab = useAtomValue(activeTabAtom)
  return <VideoControls key={`${tab.id}:${tab.url}`} />
}

function VideoControls() {
  const tab = useAtomValue(activeTabAtom)
  const [status, setStatus] = useState<SubtitleStatus | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryFailed, setRetryFailed] = useState(false)
  const retryingRef = useRef(false)
  useEffect(() => {
    let disposed = false
    let reading = false
    const read = async () => {
      if (reading || tab.id === null || !tab.translatable)
        return
      reading = true
      try {
        const next = await sendMessage("getTabSubtitleStatus", { tabId: tab.id })
        if (!disposed && next)
          setStatus(next)
      }
      catch {
        // No content script yet. Keep the section available for manual use.
      }
      finally {
        reading = false
      }
    }
    void read()
    const timer = setInterval(() => void read(), 1500)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [tab.id, tab.url, tab.translatable])
  const retry = async () => {
    if (retryingRef.current || tab.id === null)
      return
    retryingRef.current = true
    setRetrying(true)
    setRetryFailed(false)
    try {
      await sendMessage("retrySubtitleTranslation", undefined, tab.id)
    }
    catch {
      setRetryFailed(true)
    }
    finally {
      retryingRef.current = false
      setRetrying(false)
    }
  }
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const id = useId()
  const shortcut = features.subtitlesShortcut.trim() ? formatHotkey(features.subtitlesShortcut) : null

  return (
    <section aria-label={i18n.t("popup.videoSubtitles")} className="flex flex-col gap-2 border-t border-border pt-2.5">
      <TranslationControlRow
        label={i18n.t("popup.videoSubtitles")}
        controlId={id}
        hint={shortcut && <span className="text-[11px] leading-4 text-muted-foreground">{shortcut}</span>}
        control={(
          <Switch
            id={id}
            aria-label={i18n.t("features.video")}
            checked={features.videoSubtitles}
            onCheckedChange={videoSubtitles => void setFeatures({ videoSubtitles })}
          />
        )}
      />
      {status?.hasVideo && <p role="status" className="rounded-md bg-muted px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">{i18n.t(`subtitleStatus.${status.state}`)}</p>}
      {status?.state === "failed" && <button type="button" disabled={retrying} onClick={() => void retry()} className="w-fit text-[12px] text-brand hover:underline disabled:opacity-60">{i18n.t(retrying ? "popup.recovery.pending" : "subtitleStatus.retry")}</button>}
      {retryFailed && <p role="alert" className="text-[11px] text-destructive">{i18n.t("popup.recovery.failed")}</p>}
      <DisplayModeControl value={features.subtitleMode} label={i18n.t("features.mode")} onChange={subtitleMode => void setFeatures({ subtitleMode })} />
      <VideoSiteExclusionControl />
    </section>
  )
}
