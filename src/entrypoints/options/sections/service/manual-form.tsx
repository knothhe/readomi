import type { SetupDocument } from "@/utils/setup-document"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useState } from "react"
import { i18n } from "#imports"
import { Button } from "@/components/ui/button"
import { DEFAULT_REQUEST_API, PROVIDER_TYPES, REQUEST_APIS } from "@/types/config/provider"
import { configAtom, writeConfigAtom } from "@/utils/atoms/config"
import { clearConfigResetNotice } from "@/utils/config/storage"
import { logger } from "@/utils/logger"
import { checkConnection, withConnectionCheck } from "@/utils/providers/test-connection"
import { applySetupDocument, exportSetupDocument, setupDocumentSchema } from "@/utils/setup-document"

export function ManualServiceForm({ onDone }: { onDone: () => void }) {
  const config = useAtomValue(configAtom)
  const store = useStore()
  const write = useSetAtom(writeConfigAtom)
  const [draft, setDraft] = useState<SetupDocument>(() => ({
    ...exportSetupDocument(config)!,
    name: config.providersConfig.find(p => p.id === config.translate.providerId)?.name,
  }))
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldClass = "w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px]"

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const document = setupDocumentSchema.parse({
        ...draft,
        name: draft.name?.trim() || undefined,
        baseURL: draft.baseURL?.trim() || undefined,
        apiKey: key.trim() || undefined,
      })
      const { config: next, providerId } = applySetupDocument(store.get(configAtom), document)
      const check = await checkConnection(next.providersConfig.find(p => p.id === providerId)!)
      if (!check.ok)
        throw new Error(check.error || i18n.t("options.service.status.failed"))
      const saved = withConnectionCheck(next, providerId, check)
      await write({ providersConfig: saved.providersConfig, translate: saved.translate })
      await clearConfigResetNotice().catch(error => logger.error("Could not clear configuration reset notice", error))
      onDone()
    }
    catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <label>
          {i18n.t("manualService.type")}
          <select className={fieldClass} value={draft.type} onChange={e => setDraft({ type: e.target.value as typeof draft.type, model: "", api: DEFAULT_REQUEST_API[e.target.value as typeof draft.type] })}>
            {PROVIDER_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          {i18n.t("manualService.name")}
          <input className={fieldClass} value={draft.name ?? ""} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          {i18n.t("manualService.url")}
          <input className={fieldClass} type="url" value={draft.baseURL ?? ""} onChange={e => setDraft({ ...draft, baseURL: e.target.value })} />
        </label>
        <label>
          {i18n.t("manualService.key")}
          <input className={fieldClass} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">{i18n.t("manualService.keyHint")}</p>
        <label>
          {i18n.t("manualService.model")}
          <input className={fieldClass} required value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} />
        </label>
        <label>
          {i18n.t("manualService.api")}
          <select className={fieldClass} value={draft.api ?? DEFAULT_REQUEST_API[draft.type]} onChange={e => setDraft({ ...draft, api: e.target.value as typeof draft.api })}>
            {REQUEST_APIS.map(api => <option key={api} value={api}>{api}</option>)}
          </select>
        </label>
        {error && (
          <div role="alert">
            <p className="text-destructive">{i18n.t("options.service.failedNotSaved")}</p>
            <pre className="whitespace-pre-wrap break-all text-xs">{error}</pre>
          </div>
        )}
        <Button type="submit">{busy ? i18n.t("options.service.applying") : i18n.t("manualService.save")}</Button>
      </fieldset>
    </form>
  )
}
