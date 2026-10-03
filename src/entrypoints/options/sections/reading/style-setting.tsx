import type { TranslationNodeStylePreset } from "@/types/config/translate"
import { useAtom } from "jotai"
import { i18n } from "#imports"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { deepMerge } from "@/utils/object"
import { cn } from "@/utils/styles/utils"
import { SettingsRow } from "../../components/settings-section"
import { CSSEditor } from "./css-editor"

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

/**
 * The presets offered. The others stay valid for configs that already use
 * them and show up as an extra chip while selected.
 */
const OFFERED_PRESETS: readonly TranslationNodeStylePreset[] = ["line", "default", "weakened", "textColor", "background"]

const CUSTOM_CHOICE = "custom"

function StyleChoice({ preset, selected, onClick }: { preset: TranslationNodeStylePreset, selected: boolean, onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col items-center gap-2 rounded-lg border px-1 py-2.5 text-[10px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)
  const { translationNodeStyle } = translateConfig
  const selected = translationNodeStyle.isCustom ? CUSTOM_CHOICE : translationNodeStyle.preset
  const presets = OFFERED_PRESETS.includes(translationNodeStyle.preset) ? OFFERED_PRESETS : [...OFFERED_PRESETS, translationNodeStyle.preset]

  const choosePreset = (preset: TranslationNodeStylePreset) => {
    void setTranslateConfig(deepMerge(translateConfig, { translationNodeStyle: { preset, isCustom: false } }))
  }

  return (
    <SettingsRow label={i18n.t("options.reading.style.title")}>
      <div role="group" aria-label={i18n.t("options.reading.style.title")} className="grid grid-cols-5 gap-2">
        {presets.map(preset => (
          <StyleChoice key={preset} preset={preset} selected={selected === preset} onClick={() => choosePreset(preset)} />
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          aria-pressed={selected === CUSTOM_CHOICE}
          onClick={() => void setTranslateConfig(deepMerge(translateConfig, { translationNodeStyle: { isCustom: true } }))}
          className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-brand outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50", selected === CUSTOM_CHOICE && "bg-accent")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-3.5"><path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18" /></svg>
          {i18n.t("options.reading.style.custom")}
        </button>
      </div>
      {translationNodeStyle.isCustom && <CSSEditor />}
    </SettingsRow>
  )
}
