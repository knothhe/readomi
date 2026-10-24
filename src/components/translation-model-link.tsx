import type { TranslationTask } from "@/types/config/translate"
import { useAtomValue } from "jotai"
import { i18n } from "#imports"
import { IconArrowUpRight } from "@/components/icons"
import { translationProviderAtom } from "@/utils/atoms/provider"
import { openOptionsPage } from "@/utils/navigation"
import { isProviderReady } from "@/utils/service-management"
import { cn } from "@/utils/styles/utils"
import { TRANSLATION_TASK_LABELS } from "@/utils/translation-models"

export function TranslationModelLink({ task, popup = false }: { task: TranslationTask, popup?: boolean }) {
  const provider = useAtomValue(translationProviderAtom(task))
  const model = isProviderReady(provider) ? provider.model : i18n.t("translationModels.unconfigured")
  const label = i18n.t("translationModels.open", [i18n.t(TRANSLATION_TASK_LABELS[task]), model])
  const content = (
    <>
      <span className="truncate">{model}</span>
      <IconArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
    </>
  )
  const className = cn("inline-flex min-w-0 max-w-full items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50", popup ? "max-w-[185px] text-[10px] leading-4" : "text-[11px] leading-5")
  return popup
    ? <button type="button" className={className} aria-label={label} title={label} onClick={() => void openOptionsPage({ section: `service/models/${task}` })}>{content}</button>
    : <a href={`#service/models/${task}`} className={className} aria-label={label} title={label}>{content}</a>
}
