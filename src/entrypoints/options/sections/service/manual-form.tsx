import type { ProviderConfig } from "@/types/config/provider"
import type { SetupDocument } from "@/utils/setup-document"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { i18n } from "#imports"
import { Button } from "@/components/ui/button"
import { DEFAULT_REQUEST_API, PROVIDER_TYPES, REQUEST_APIS } from "@/types/config/provider"
import { configAtom } from "@/utils/atoms/config"
import { saveProviderAtom } from "@/utils/atoms/service"
import { PROVIDER_ITEMS } from "@/utils/constants/providers"
import { fetchProviderModels } from "@/utils/providers/models"
import { resolveBaseURL } from "@/utils/providers/request"
import { checkConnection } from "@/utils/providers/test-connection"
import { applySetupDocument, exportSetupDocument, setupDocumentSchema } from "@/utils/setup-document"
import { SettingsSelect } from "../../components/settings-select"
import { UseAfterAdd } from "./use-after-add"

const BODY_EXAMPLES = {
  "openai-responses": { reasoning: { effort: "none" } },
  "openai-chat": { reasoning_effort: "none" },
  "anthropic": { thinking: { type: "disabled" } },
  "gemini": { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } },
}

export function ManualServiceForm({ current, makeCurrent, onMakeCurrentChange, onBusyChange, onDone, onCancel }: { current?: ProviderConfig, makeCurrent: boolean, onMakeCurrentChange?: (value: boolean) => void, onBusyChange: (value: boolean) => void, onDone: () => void, onCancel?: () => void }) {
  const config = useAtomValue(configAtom)
  const store = useStore()
  const saveProvider = useSetAtom(saveProviderAtom)
  const [draft, setDraft] = useState<SetupDocument>(() => ({
    ...(current ? exportSetupDocument(config, current.id)! : { type: "openai" as const, model: "" }),
    name: current?.name,
  }))
  const [key, setKey] = useState("")
  const [bodyText, setBodyText] = useState(() => draft.body ? JSON.stringify(draft.body, null, 2) : "")
  const [bodyExpanded, setBodyExpanded] = useState(() => !!draft.body || draft.type === "openai-compatible")
  const body = useMemo(() => {
    try {
      return setupDocumentSchema.shape.body.safeParse(bodyText.trim() ? JSON.parse(bodyText) : undefined)
    }
    catch {
      return { success: false } as const
    }
  }, [bodyText])
  const api = draft.api ?? DEFAULT_REQUEST_API[draft.type]
  const bodyExample = api === "openai-chat" && draft.type === "deepseek"
    ? { thinking: { type: "disabled" } }
    : BODY_EXAMPLES[api]
  const bodyExampleText = JSON.stringify(bodyExample)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelResult, setModelResult] = useState<{ signature: string, models: string[], state: "idle" | "loading" | "list" | "empty" | "failed" }>({ signature: "", models: [], state: "idle" })
  const requestRef = useRef<AbortController | null>(null)
  // A save may finish after the reader opens another editor.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  // A stored key belongs to its endpoint; never carry it to a new address.
  const matching = current ? config.providersConfig.find(provider => provider.id === current.id && provider.provider === draft.type && resolveBaseURL(provider) === resolveBaseURL({ provider: draft.type, baseURL: draft.baseURL })) : undefined
  const effectiveKey = key.trim() || matching?.apiKey?.trim()
  const baseURL = resolveBaseURL({ provider: draft.type, baseURL: draft.baseURL })
  const canFetch = !!effectiveKey && !!baseURL
  const signature = JSON.stringify([draft.type, draft.api, draft.baseURL, matching?.headers, effectiveKey])
  const models = modelResult.signature === signature ? modelResult.models : []
  const modelState = modelResult.signature === signature ? modelResult.state : "idle"
  useEffect(() => {
    return () => requestRef.current?.abort()
  }, [signature])

  const fetchModels = async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setModelResult({ signature, models: [], state: "loading" })
    try {
      const latest = matching ? store.get(configAtom).providersConfig.find(provider => provider.id === matching.id && provider.provider === draft.type && resolveBaseURL(provider) === baseURL) : undefined
      const result = await fetchProviderModels({ provider: draft.type, api: draft.api, baseURL: draft.baseURL, apiKey: key.trim() || latest?.apiKey, headers: latest?.headers }, controller.signal)
      if (!controller.signal.aborted && requestRef.current === controller) {
        setModelResult({ signature, models: result, state: result.length ? "list" : "empty" })
      }
    }
    catch {
      if (!controller.signal.aborted && requestRef.current === controller)
        setModelResult({ signature, models: [], state: "failed" })
    }
  }
  const modelId = useId()
  const modelsId = useId()
  const typeId = useId()
  const nameId = useId()
  const urlId = useId()
  const keyId = useId()
  const apiId = useId()
  const bodyId = useId()
  const fieldClass = "w-full rounded-lg border border-input bg-card px-3 py-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
  const labelClass = "text-xs font-medium"

  const save = async () => {
    if (!body.success)
      return
    setBusy(true)
    onBusyChange(true)
    setError(null)
    try {
      const document = setupDocumentSchema.parse({
        ...draft,
        body: body.data,
        name: draft.name?.trim() || undefined,
        baseURL: draft.baseURL?.trim() || undefined,
        apiKey: key.trim() || (matching ? draft.apiKey : undefined),
      })
      const { config: next, providerId } = applySetupDocument(store.get(configAtom), document, { mode: current ? "edit" : "add", providerId: current?.id, makeCurrent })
      const provider = next.providersConfig.find(p => p.id === providerId)!
      const check = await checkConnection(provider)
      if (!check.ok)
        throw new Error(check.error || i18n.t("options.service.status.failed"))
      await saveProvider({ provider: { ...provider, connectionCheck: check }, mode: current ? "edit" : "add", makeCurrent })
      if (mountedRef.current)
        onDone()
    }
    catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
    finally {
      setBusy(false)
      onBusyChange(false)
    }
  }

  return (
    <form
      className="settings-manual-form flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <p className="text-xs leading-5 text-muted-foreground">{i18n.t("manualService.intro")}</p>
      <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
          <label className={labelClass} htmlFor={typeId}>{i18n.t("manualService.type")}</label>
          <SettingsSelect
            id={typeId}
            className="w-full"
            value={draft.type}
            disabled={busy}
            options={PROVIDER_TYPES.map(type => ({ value: type, label: type === "openai-compatible" ? i18n.t("manualService.compatible") : PROVIDER_ITEMS[type].name }))}
            onValueChange={(value) => {
              setDraft({ type: value as typeof draft.type, model: "", api: DEFAULT_REQUEST_API[value as typeof draft.type] })
              setBodyText("")
              setBodyExpanded(value === "openai-compatible")
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
          <label className={labelClass} htmlFor={keyId}>{i18n.t("manualService.key")}</label>
          <input id={keyId} className={fieldClass} type="password" autoComplete="off" value={key} aria-describedby={`${keyId}-hint`} onChange={e => setKey(e.target.value)} />
          <p id={`${keyId}-hint`} className="text-[11px] leading-[1.7] text-muted-foreground">{i18n.t("manualService.keyHint")}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
          <label className={labelClass} htmlFor={modelId}>{i18n.t("manualService.model")}</label>
          <div className="flex flex-wrap gap-2">
            <input id={modelId} className={`${fieldClass} min-w-0 flex-1`} required value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} />
            <Button type="button" variant="outline" disabled={!canFetch || modelState === "loading"} onClick={() => void fetchModels()}>{i18n.t(modelState === "loading" ? "modelDiscovery.loading" : "modelDiscovery.fetch")}</Button>
          </div>
          <p className="text-[11px] leading-[1.7] text-muted-foreground" role="status">
            {i18n.t(!canFetch ? "modelDiscovery.noKey" : modelState === "failed" ? "modelDiscovery.failed" : modelState === "empty" ? "modelDiscovery.empty" : "modelDiscovery.hint")}
          </p>
          {modelState === "list" && (
            <div className="flex flex-col gap-2">
              <label className={labelClass} htmlFor={modelsId}>{i18n.t("modelDiscovery.select")}</label>
              <SettingsSelect
                id={modelsId}
                className="w-full"
                value={models.includes(draft.model) ? draft.model : ""}
                disabled={busy}
                options={[{ value: "", label: i18n.t("modelDiscovery.select"), disabled: true }, ...models.map(model => ({ value: model, label: model }))]}
                onValueChange={value => value && setDraft({ ...draft, model: value })}
              />
            </div>
          )}
        </div>
        <details className="border-y border-border py-4 sm:col-span-2" open={bodyExpanded || !body.success} onToggle={event => setBodyExpanded(event.currentTarget.open)}>
          <summary className="cursor-pointer text-xs font-medium">{i18n.t("manualService.advanced")}</summary>
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <label className={labelClass} htmlFor={nameId}>{i18n.t("manualService.name")}</label>
              <input id={nameId} className={fieldClass} value={draft.name ?? ""} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
              <label className={labelClass} htmlFor={urlId}>{i18n.t("manualService.url")}</label>
              <input id={urlId} className={fieldClass} type="url" placeholder={baseURL} value={draft.baseURL ?? ""} onChange={e => setDraft({ ...draft, baseURL: e.target.value })} />
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
              <label className={labelClass} htmlFor={apiId}>{i18n.t("manualService.api")}</label>
              <SettingsSelect
                id={apiId}
                className="w-full"
                value={draft.api ?? DEFAULT_REQUEST_API[draft.type]}
                disabled={busy}
                options={REQUEST_APIS.map(api => ({ value: api, label: api }))}
                onValueChange={value => setDraft({ ...draft, api: value as typeof draft.api })}
              />
            </div>
          </div>
          <div className="mt-4 flex min-w-0 flex-col gap-2">
            <label className={labelClass} htmlFor={bodyId}>{i18n.t("manualService.body")}</label>
            <textarea
              id={bodyId}
              aria-label={i18n.t("manualService.body")}
              className={`${fieldClass} resize-y font-mono text-xs leading-[18px]`}
              rows={5}
              spellCheck={false}
              value={bodyText}
              placeholder={JSON.stringify(bodyExample, null, 2)}
              aria-invalid={!body.success}
              aria-describedby={`${bodyId}-hint ${bodyId}-example${body.success ? "" : ` ${bodyId}-error`}`}
              onChange={e => setBodyText(e.target.value)}
            />
            <p id={`${bodyId}-hint`} className="text-[11px] leading-[1.7] text-muted-foreground">{i18n.t("manualService.bodyHint")}</p>
            <p id={`${bodyId}-example`} className="break-words text-[11px] leading-[1.7] text-muted-foreground">
              {i18n.t("manualService.bodyExample")}
              {" "}
              <code>{bodyExampleText}</code>
            </p>
            {!body.success && <p id={`${bodyId}-error`} role="alert" className="text-xs text-destructive">{i18n.t("manualService.bodyInvalid")}</p>}
          </div>
        </details>
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:col-span-2">
            <p className="text-xs font-medium text-destructive">{i18n.t("options.service.failedNotSaved")}</p>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted-foreground">{error}</pre>
          </div>
        )}
        {current && <p className="text-[11px] text-muted-foreground sm:col-span-2">{i18n.t("options.service.editHint")}</p>}
        {!current && <div className="sm:col-span-2"><UseAfterAdd value={makeCurrent} onChange={onMakeCurrentChange} disabled={busy} /></div>}
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
          {onCancel && <Button type="button" variant="outline" onClick={onCancel}>{i18n.t("options.service.cancel")}</Button>}
          <Button type="submit" disabled={!body.success || !draft.model.trim() || !effectiveKey}>{busy ? i18n.t("options.service.applying") : i18n.t(current ? "options.service.checkSave" : "options.service.checkAdd")}</Button>
        </div>
      </fieldset>
    </form>
  )
}
