import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { formatHotkey } from "@/utils/os"
import { TranslationControlRow } from "./translation-control-row"

/** Toggle subtitles using the display mode chosen in Settings. */
export function VideoTranslationControl() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const id = useId()
  const shortcut = features.subtitlesShortcut.trim() ? formatHotkey(features.subtitlesShortcut) : null

  return (
    <section aria-label={i18n.t("popup.videoSubtitles")} className="flex flex-col gap-2 pt-2.5">
      <TranslationControlRow
        label={i18n.t("popup.videoSubtitles")}
        controlId={id}
        hint={shortcut && <span className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">{shortcut}</span>}
        control={(
          <Switch
            id={id}
            aria-label={i18n.t("features.video")}
            checked={features.videoSubtitles}
            onCheckedChange={videoSubtitles => void setFeatures({ videoSubtitles })}
          />
        )}
      />
    </section>
  )
}
