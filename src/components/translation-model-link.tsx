import type { TranslationTask } from "@/types/config/translate"
import { useAtomValue } from "jotai"
import { i18n } from "#imports"
import { IconArrowUpRight } from "@/components/icons"
import { translationProviderAtom } from "@/utils/atoms/provider"
import { openOptionsPage } from "@/utils/navigation"
import { isProviderReady } from "@/utils/service-management"
import { TRANSLATION_TASK_LABELS } from "@/utils/translation-models"

export function TranslationModelLink({ task }: { task: TranslationTask }) {
  const provider = useAtomValue(translationProviderAtom(task))
  const model = isProviderReady(provider) ? provider.model : i18n.t("translationModels.unconfigured")
  const label = i18n.t("translationModels.open", [i18n.t(TRANSLATION_TASK_LABELS[task]), model])
  return (
    <button
      type="button"
      className="inline-flex min-w-0 max-w-[185px] items-center gap-1 rounded text-[10px] leading-4 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={label}
      title={label}
      onClick={() => void openOptionsPage({ section: `service/models/${task}` })}
    >
      <span className="truncate">{model}</span>
      <IconArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
    </button>
  )
}
