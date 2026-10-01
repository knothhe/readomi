import { i18n } from "#imports"
import { BrandIcon } from "@/components/brand-icon"

export function SettingsHeader() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <BrandIcon className="size-7" />
        <span className="text-lg font-bold">Readomi</span>
      </div>
      <h1 className="text-[22px] font-bold tracking-tight">{i18n.t("options.title")}</h1>
    </div>
  )
}
