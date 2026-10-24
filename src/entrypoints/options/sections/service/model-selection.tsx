import type { TranslationTask } from "@/types/config/translate"
import { useAtomValue, useSetAtom } from "jotai"
import { useEffect, useRef, useState } from "react"
import { i18n } from "#imports"
import { TRANSLATION_TASKS } from "@/types/config/translate"
import { configAtom, mutateConfigAtom } from "@/utils/atoms/config"
import { initialProviderPlaceholder, isProviderReady } from "@/utils/service-management"
import { TRANSLATION_TASK_LABELS } from "@/utils/translation-models"
import { SettingsSelect } from "../../components/settings-select"

export function ModelSelection({ task, onAdd }: { task?: TranslationTask, onAdd: () => void }) {
  const config = useAtomValue(configAtom)
  const save = useSetAtom(mutateConfigAtom)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const providers = config.providersConfig.filter(isProviderReady)
  const current = config.providersConfig.find(provider => provider.id === config.translate.providerId)
  const placeholder = initialProviderPlaceholder(config)

  useEffect(() => {
    if (task)
      rootRef.current?.querySelector<HTMLButtonElement>(`#translation-model-${task}`)?.focus()
  }, [task])

  const choose = async (task: TranslationTask, providerId: string) => {
    if (pendingRef.current)
      return
    pendingRef.current = true
    setPending(true)
    setFailed(false)
    try {
      await save(latest => ({
        ...latest,
        translate: { ...latest.translate, modelProviders: { ...latest.translate.modelProviders, [task]: providerId || null } },
      }))
    }
    catch {
      setFailed(true)
    }
    finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <div ref={rootRef} className="settings-model-selection" aria-busy={pending}>
      <p className="settings-model-hint">{i18n.t("translationModels.description")}</p>
      {TRANSLATION_TASKS.map(task => (
        <div key={task} className="settings-model-row">
          <label htmlFor={`translation-model-${task}`}>{i18n.t(TRANSLATION_TASK_LABELS[task])}</label>
          <SettingsSelect
            id={`translation-model-${task}`}
            value={config.translate.modelProviders[task] ?? ""}
            disabled={pending || !providers.length}
            options={[
              { value: "", label: providers.length ? i18n.t("translationModels.follow", [current?.model ?? ""]) : i18n.t("translationModels.unconfigured"), disabled: !isProviderReady(current) },
              ...config.providersConfig.filter(provider => provider.id !== placeholder?.id).map(provider => ({ value: provider.id, label: `${provider.name} · ${provider.model}`, disabled: !isProviderReady(provider) })),
            ]}
            onValueChange={value => void choose(task, value)}
          />
        </div>
      ))}
      {!providers.length && (
        <div className="mt-5 flex flex-col items-start gap-3">
          <p className="settings-model-hint">{i18n.t("translationModels.empty")}</p>
          <button type="button" className="settings-service-add" onClick={onAdd}>{i18n.t("options.service.add")}</button>
        </div>
      )}
      {failed && <p role="alert" className="mt-4 text-xs text-destructive">{i18n.t("translationModels.saveFailed")}</p>}
    </div>
  )
}
