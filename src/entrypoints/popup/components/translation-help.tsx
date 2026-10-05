import type { ReactNode } from "react"
import { useAtomValue } from "jotai"
import { i18n } from "#imports"
import { openOptionsPage } from "@/utils/navigation"
import { pageTranslationEnabledAtom } from "../atoms"
import { PageRecoveryActions } from "./page-recovery-actions"

export function TranslationHelp({ children }: { children: ReactNode }) {
  const enabled = useAtomValue(pageTranslationEnabledAtom)
  return (
    <details className="border-t border-border pt-2.5">
      <summary className="cursor-pointer rounded text-[12px] leading-5 text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50">{i18n.t("popup.recovery.help")}</summary>
      <div className="flex flex-col gap-2 pt-2">
        {!enabled && <PageRecoveryActions />}
        <button type="button" className="w-fit rounded text-left text-[12px] leading-5 text-muted-foreground hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => void openOptionsPage({ section: "quality" })}>
          {i18n.t("popup.recovery.quality")}
        </button>
        {children}
      </div>
    </details>
  )
}
