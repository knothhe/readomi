import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { openOptionsPage } from "@/utils/navigation"
import { formatHotkey } from "@/utils/os"
import { subtitlePositionName } from "@/utils/subtitles/appearance"
import { DisplayModeControl } from "./display-mode-control"
import { TranslationControlRow } from "./translation-control-row"
import { VideoSiteExclusionControl } from "./video-site-exclusion-control"

/** Subtitle modes are edited here independently of web text, without opening Settings. */
export function VideoTranslationControl() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const id = useId()
  const shortcut = features.subtitlesShortcut.trim() ? formatHotkey(features.subtitlesShortcut) : null
  const style = features.subtitleStyle
  const summary = [i18n.t(`subtitleStyle.presets.${style.preset}`), `${style.fontSize} px`, i18n.t(`subtitleStyle.positions.${subtitlePositionName(style.position)}`)].join(" · ")

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
      <div className="flex items-center justify-between gap-2 px-0.5 py-0.5 text-[11px] leading-4">
        <span className="min-w-0 truncate text-muted-foreground" title={summary}>{summary}</span>
        <button
          type="button"
          onClick={() => void openOptionsPage({ section: "features" })}
          className="shrink-0 rounded text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {i18n.t("subtitleStyle.adjust")}
        </button>
      </div>
      <VideoSiteExclusionControl />
    </section>
  )
}
