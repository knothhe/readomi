import { i18n } from "#imports"
import { BrandIcon } from "@/components/brand-icon"
import { EXTENSION_VERSION } from "@/utils/constants/app"

export function SettingsHeader() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <BrandIcon className="size-7" />
        <div className="flex flex-col gap-1">
          <span className="text-lg font-bold">Readomi</span>
          <span className="text-[11px] text-muted-foreground">{`${i18n.t("options.version")} ${EXTENSION_VERSION}`}</span>
        </div>
      </div>
      <h1 className="text-[22px] font-bold tracking-tight">{i18n.t("options.title")}</h1>
    </div>
  )
}
