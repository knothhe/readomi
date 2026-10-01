import type { SetupDocument } from "@/utils/setup-document"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { i18n } from "#imports"
import { Button } from "@/components/ui/button"
import { DEFAULT_REQUEST_API, PROVIDER_TYPES, REQUEST_APIS } from "@/types/config/provider"
import { configAtom, writeConfigAtom } from "@/utils/atoms/config"
import { clearConfigResetNotice } from "@/utils/config/storage"
import { logger } from "@/utils/logger"
import { fetchProviderModels } from "@/utils/providers/models"
import { resolveBaseURL } from "@/utils/providers/request"
import { checkConnection, withConnectionCheck } from "@/utils/providers/test-connection"
import { applySetupDocument, exportSetupDocument, findMatchingProvider, setupDocumentSchema } from "@/utils/setup-document"

const BODY_EXAMPLES = {
  "openai-responses": { reasoning: { effort: "none" } },
  "openai-chat": { reasoning_effort: "none" },
  "anthropic": { thinking: { type: "disabled" } },
  "gemini": { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } },
}

export function ManualServiceForm({ onDone }: { onDone: () => void }) {
  const config = useAtomValue(configAtom)
  const store = useStore()
  const write = useSetAtom(writeConfigAtom)
  const [draft, setDraft] = useState<SetupDocument>(() => ({
    ...exportSetupDocument(config)!,
    name: config.providersConfig.find(p => p.id === config.translate.providerId)?.name,
  }))
  const [key, setKey] = useState("")
  const [bodyText, setBodyText] = useState(() => draft.body ? JSON.stringify(draft.body, null, 2) : "")
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
  // A stored key belongs to its endpoint; never carry it to a new address.
  const matching = findMatchingProvider(config.providersConfig, draft)
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
      const latest = findMatchingProvider(store.get(configAtom).providersConfig, draft)
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
  const bodyId = useId()
  const fieldClass = "w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px]"

  const save = async () => {
    if (!body.success)
      return
    setBusy(true)
    setError(null)
    try {
      const document = setupDocumentSchema.parse({
        ...draft,
        body: body.data,
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
          <select
            className={fieldClass}
            value={draft.type}
            onChange={(e) => {
              setDraft({ type: e.target.value as typeof draft.type, model: "", api: DEFAULT_REQUEST_API[e.target.value as typeof draft.type] })
              setBodyText("")
            }}
          >
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
        <div>
          <label htmlFor={modelId}>{i18n.t("manualService.model")}</label>
          <div className="flex gap-2">
            <input id={modelId} className={`${fieldClass} min-w-0 flex-1`} required value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} />
            <Button type="button" variant="outline" disabled={!canFetch || modelState === "loading"} onClick={() => void fetchModels()}>{i18n.t(modelState === "loading" ? "modelDiscovery.loading" : "modelDiscovery.fetch")}</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {i18n.t(!canFetch ? "modelDiscovery.noKey" : modelState === "failed" ? "modelDiscovery.failed" : modelState === "empty" ? "modelDiscovery.empty" : "modelDiscovery.hint")}
        </p>
        {modelState === "list" && (
          <label>
            {i18n.t("modelDiscovery.select")}
            <select className={fieldClass} value={models.includes(draft.model) ? draft.model : ""} onChange={e => e.target.value && setDraft({ ...draft, model: e.target.value })}>
              <option value="" disabled>{i18n.t("modelDiscovery.select")}</option>
              {models.map(model => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
        )}
        <label>
          {i18n.t("manualService.api")}
          <select className={fieldClass} value={draft.api ?? DEFAULT_REQUEST_API[draft.type]} onChange={e => setDraft({ ...draft, api: e.target.value as typeof draft.api })}>
            {REQUEST_APIS.map(api => <option key={api} value={api}>{api}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-2">
          <label htmlFor={bodyId}>{i18n.t("manualService.body")}</label>
          <textarea
            id={bodyId}
            className={`${fieldClass} resize-y font-mono text-xs leading-[18px]`}
            rows={5}
            spellCheck={false}
            value={bodyText}
            placeholder={JSON.stringify(bodyExample, null, 2)}
            aria-invalid={!body.success}
            aria-describedby={`${bodyId}-hint ${bodyId}-example${body.success ? "" : ` ${bodyId}-error`}`}
            onChange={e => setBodyText(e.target.value)}
          />
          <p id={`${bodyId}-hint`} className="text-xs text-muted-foreground">{i18n.t("manualService.bodyHint")}</p>
          <p id={`${bodyId}-example`} className="break-words text-xs text-muted-foreground">
            {i18n.t("manualService.bodyExample")}
            {" "}
            <code>{bodyExampleText}</code>
          </p>
          {!body.success && <p id={`${bodyId}-error`} role="alert" className="text-xs text-destructive">{i18n.t("manualService.bodyInvalid")}</p>}
        </div>
        {error && (
          <div role="alert">
            <p className="text-destructive">{i18n.t("options.service.failedNotSaved")}</p>
            <pre className="whitespace-pre-wrap break-all text-xs">{error}</pre>
          </div>
        )}
        <Button type="submit" disabled={!body.success}>{busy ? i18n.t("options.service.applying") : i18n.t("manualService.save")}</Button>
      </fieldset>
    </form>
  )
}
