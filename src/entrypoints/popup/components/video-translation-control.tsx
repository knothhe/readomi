import { useAtomValue } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { formatHotkey } from "@/utils/os"
import { isVideoTranslationExcluded } from "@/utils/subtitles/video-site-rules"
import { activeTabAtom } from "../atoms"
import { usePageSubtitles } from "../use-page-subtitles"
import { TranslationControlRow } from "./translation-control-row"

/** All three subtitle controls use the active page's effective switch. */
export function VideoTranslationControl({ disabled = false }: { disabled?: boolean }) {
  const features = useAtomValue(configFieldsAtomMap.features)
  const tab = useAtomValue(activeTabAtom)
  // The last background state may still describe the disabled website.
  // Only current page policy can establish unavailability during resumption.
  const unavailable = !tab.translatable || isVideoTranslationExcluded(tab.url, features.videoExcludedSites)
  const { state, selectedEnabled, pending, failed, choose, translatable } = usePageSubtitles(disabled || unavailable)
  const resuming = !disabled && !unavailable && !state?.available
  const id = useId()
  const shortcut = features.subtitlesShortcut.trim() ? formatHotkey(features.subtitlesShortcut) : null

  return (
    <section aria-label={i18n.t("popup.videoSubtitles")}>
      <TranslationControlRow
        label={i18n.t("popup.videoSubtitles")}
        controlId={id}
        disabled={disabled || unavailable || resuming}
        hint={shortcut && <span className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">{shortcut}</span>}
        control={(
          <Switch
            className="popup-switch"
            id={id}
            aria-label={i18n.t("features.video")}
            title={i18n.t("popup.subtitlePage.scope")}
            checked={translatable && (disabled || resuming) ? selectedEnabled : state?.enabled ?? false}
            disabled={disabled || unavailable || !state?.available || pending}
            aria-busy={pending || (resuming && !failed)}
            onCheckedChange={enabled => void choose(enabled)}
          />
        )}
      />
      {!disabled && failed && <p role="status" className="text-[11px] leading-4 text-destructive">{i18n.t("popup.subtitlePage.failed")}</p>}
      {!failed && (!translatable || (!disabled && unavailable)) && <p role="status" className="text-[11px] leading-4 text-muted-foreground">{i18n.t("popup.subtitlePage.unavailable")}</p>}
    </section>
  )
}
