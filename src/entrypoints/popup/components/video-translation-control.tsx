import { useAtomValue } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { formatHotkey } from "@/utils/os"
import { usePageSubtitles } from "../use-page-subtitles"
import { TranslationControlRow } from "./translation-control-row"

/** All three subtitle controls use the active page's effective switch. */
export function VideoTranslationControl() {
  const features = useAtomValue(configFieldsAtomMap.features)
  const { state, pending, failed, choose, translatable } = usePageSubtitles()
  const id = useId()
  const shortcut = features.subtitlesShortcut.trim() ? formatHotkey(features.subtitlesShortcut) : null

  return (
    <section aria-label={i18n.t("popup.videoSubtitles")}>
      <TranslationControlRow
        label={i18n.t("popup.videoSubtitles")}
        controlId={id}
        hint={shortcut && <span className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">{shortcut}</span>}
        control={(
          <Switch
            className="popup-switch"
            id={id}
            aria-label={i18n.t("features.video")}
            title={i18n.t("popup.subtitlePage.scope")}
            checked={state?.enabled ?? false}
            disabled={!state?.available || pending}
            aria-busy={pending || (translatable && !state && !failed)}
            onCheckedChange={enabled => void choose(enabled)}
          />
        )}
      />
      {failed && <p role="status" className="text-[11px] leading-4 text-destructive">{i18n.t("popup.subtitlePage.failed")}</p>}
      {!failed && (!translatable || (state && !state.available)) && <p role="status" className="text-[11px] leading-4 text-muted-foreground">{i18n.t("popup.subtitlePage.unavailable")}</p>}
    </section>
  )
}
