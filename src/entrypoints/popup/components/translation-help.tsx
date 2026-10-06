import type { ReactNode } from "react"
import { i18n } from "#imports"
import { openOptionsPage } from "@/utils/navigation"
import { PopupHelpAction } from "./popup-help-action"

export function TranslationHelp({ children }: { children: ReactNode }) {
  return (
    <details className="border-t border-border pt-2.5">
      <summary className="cursor-pointer rounded text-[12px] leading-5 text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50">{i18n.t("popup.recovery.help")}</summary>
      <div className="flex flex-col gap-2 pt-2">
        <PopupHelpAction onClick={() => void openOptionsPage({ section: "quality" })}>
          {i18n.t("popup.recovery.quality")}
        </PopupHelpAction>
        {children}
      </div>
    </details>
  )
}
