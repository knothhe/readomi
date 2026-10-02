import { useAtom } from "jotai"
import { i18n } from "#imports"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { THEME_MODES } from "@/utils/theme"
import { SegmentedControl } from "./segmented-control"
import { toast } from "./toast"

export function AppearanceModeControl({ className }: { className?: string }) {
  const [appearance, setAppearance] = useAtom(configFieldsAtomMap.appearance)
  return (
    <SegmentedControl
      aria-label={i18n.t("appearanceMode.title")}
      size="sm"
      className={className}
      value={appearance.mode}
      options={THEME_MODES.map(value => ({ value, label: i18n.t(`appearanceMode.${value}`) }))}
      onChange={mode => void setAppearance({ mode }).catch(() => toast.error(i18n.t("options.appearance.saveFailed")))}
    />
  )
}
