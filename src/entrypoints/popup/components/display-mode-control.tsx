import type { TranslationMode } from "@/types/config/translate"
import { i18n } from "#imports"
import { SegmentedControl } from "@/components/segmented-control"

export function DisplayModeControl({ value, onChange, label }: { value: TranslationMode, onChange: (value: TranslationMode) => void, label: string }) {
  return (
    <SegmentedControl
      aria-label={label}
      size="sm"
      className="[&_button]:text-[12px]"
      value={value}
      options={[
        { value: "bilingual", label: i18n.t("popup.bilingual") },
        { value: "translationOnly", label: i18n.t("popup.translationOnly") },
      ]}
      onChange={onChange}
    />
  )
}
