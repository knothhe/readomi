import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { formatHotkey } from "@/utils/os"
import { DisplayModeControl } from "./display-mode-control"
import { TranslationControlRow } from "./translation-control-row"
import { VideoSiteExclusionControl } from "./video-site-exclusion-control"

/** Subtitle modes are edited here independently of web text, without opening Settings. */
export function VideoTranslationControl() {
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
      <DisplayModeControl value={features.subtitleMode} label={i18n.t("features.mode")} onChange={subtitleMode => void setFeatures({ subtitleMode })} />
      <VideoSiteExclusionControl />
    </section>
  )
}
