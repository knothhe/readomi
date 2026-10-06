import type { ReactNode } from "react"
import { i18n } from "#imports"
import { IconChevronDown } from "@/components/icons"
import { openOptionsPage } from "@/utils/navigation"
import { PopupHelpAction } from "./popup-help-action"

export function TranslationHelp({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-1">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded text-[12px] leading-5 text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <IconChevronDown aria-hidden="true" className="size-3 -rotate-90 transition-transform group-open:rotate-0" stroke={1.75} />
        {i18n.t("popup.recovery.help")}
      </summary>
      <div className="flex flex-col">
        <PopupHelpAction onClick={() => void openOptionsPage({ section: "quality" })}>
          {i18n.t("popup.recovery.quality")}
        </PopupHelpAction>
        {children}
      </div>
    </details>
  )
}
