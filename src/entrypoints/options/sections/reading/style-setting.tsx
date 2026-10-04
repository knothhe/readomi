import type { TranslationNodeStylePreset } from "@/types/config/translate"
import { useAtomValue, useSetAtom } from "jotai"
import { i18n } from "#imports"
import { configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { cn } from "@/utils/styles/utils"
import { SettingsRow } from "../../components/settings-section"

const PRESET_LABEL_KEY = {
  default: "options.reading.style.presets.default",
  line: "options.reading.style.presets.line",
  weakened: "options.reading.style.presets.weakened",
  textColor: "options.reading.style.presets.textColor",
  dashedLine: "options.reading.style.presets.dashedLine",
  background: "options.reading.style.presets.background",
  blockquote: "options.reading.style.presets.blockquote",
  border: "options.reading.style.presets.border",
  blur: "options.reading.style.presets.blur",
} as const satisfies Record<TranslationNodeStylePreset, string>

const PRESETS: readonly TranslationNodeStylePreset[] = ["line", "default", "weakened", "textColor", "background", "dashedLine", "blockquote", "border", "blur"]

function StyleChoice({ preset, selected, onClick }: { preset: TranslationNodeStylePreset, selected: boolean, onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      onFocus={event => event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" })}
      className={cn(
        "settings-reading-style-choice transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-primary bg-accent text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-6 items-center font-serif text-[20px] leading-none text-foreground",
          preset === "line" && "border-l-2 border-brand pl-1.5",
          preset === "weakened" && "opacity-50",
          preset === "textColor" && "text-brand",
          preset === "dashedLine" && "underline decoration-dashed underline-offset-4",
          preset === "background" && "rounded-sm bg-accent px-1.5",
          preset === "blockquote" && "border-l-4 border-brand pl-1.5",
          preset === "border" && "rounded-sm border border-brand px-1.5",
          preset === "blur" && "blur-[2px]",
        )}
      >
        Aa
      </span>
      <span>{i18n.t(PRESET_LABEL_KEY[preset])}</span>
    </button>
  )
}

export function StyleSetting() {
  const translateConfig = useAtomValue(configFieldsAtomMap.translate)
  const writeConfig = useSetAtom(writeConfigAtom)
  const { translationNodeStyle } = translateConfig

  const choosePreset = (preset: TranslationNodeStylePreset) => {
    void writeConfig({ translate: { translationNodeStyle: { preset, isCustom: false } } })
  }

  return (
    <SettingsRow label={i18n.t("options.reading.style.title")}>
      <div role="group" aria-label={i18n.t("options.reading.style.title")} className="settings-reading-style-options">
        {PRESETS.map(preset => (
          <StyleChoice key={preset} preset={preset} selected={!translationNodeStyle.isCustom && translationNodeStyle.preset === preset} onClick={() => choosePreset(preset)} />
        ))}
      </div>
    </SettingsRow>
  )
}
