import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { openOptionsPage } from "@/utils/navigation"
import { formatHotkey } from "@/utils/os"
import { TranslationControlRow } from "./translation-control-row"

/** The same global subtitle preference and display mode as Settings. */
export function VideoTranslationControl() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const id = useId()
  const mode = i18n.t(`options.reading.mode.${features.subtitleMode}`)
  const shortcut = features.subtitlesShortcut.trim() ? formatHotkey(features.subtitlesShortcut) : null

  return (
    <TranslationControlRow
      label={i18n.t("features.video")}
      controlId={id}
      hint={(
        <button
          type="button"
          aria-label={i18n.t("features.mode")}
          title={i18n.t("features.videoDescription")}
          onClick={() => void openOptionsPage({ section: "features" })}
          className="max-w-full truncate rounded text-left text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {mode}
          {shortcut && ` · ${shortcut}`}
        </button>
      )}
      control={(
        <Switch
          id={id}
          aria-label={i18n.t("features.video")}
          checked={features.videoSubtitles}
          onCheckedChange={videoSubtitles => void setFeatures({ videoSubtitles })}
        />
      )}
    />
  )
}
