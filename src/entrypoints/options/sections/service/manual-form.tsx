import type { ProviderConfig, ProviderType } from "@/types/config/provider"
import type { SetupDocument } from "@/utils/setup-document"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useEffect, useId, useRef, useState } from "react"
import { i18n } from "#imports"
import { IconCpu, IconEye, IconEyeOff, IconKey, IconLink, IconList, IconServer } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { DEFAULT_REQUEST_API, PROVIDER_TYPES } from "@/types/config/provider"
import { configAtom } from "@/utils/atoms/config"
import { saveProviderAtom } from "@/utils/atoms/service"
import { PROVIDER_ITEMS } from "@/utils/constants/providers"
import { fetchProviderModels } from "@/utils/providers/models"
import { resolveBaseURL, resolveRequestApi } from "@/utils/providers/request"
import { checkConnection } from "@/utils/providers/test-connection"
import { applySetupDocument, exportSetupDocument, setupDocumentSchema } from "@/utils/setup-document"
import { SettingsSelect } from "../../components/settings-select"
import { UseAfterAdd } from "./use-after-add"

export function ManualServiceForm({ current, makeCurrent, onMakeCurrentChange, onBusyChange, onDone, onCancel, onProviderChange }: { current?: ProviderConfig, makeCurrent: boolean, onMakeCurrentChange?: (value: boolean) => void, onBusyChange: (value: boolean) => void, onDone: () => void, onCancel?: () => void, onProviderChange: (provider: ProviderType) => void }) {
  const config = useAtomValue(configAtom)
  const store = useStore()
  const saveProvider = useSetAtom(saveProviderAtom)
  const [draft, setDraft] = useState<SetupDocument>(() => ({
    ...(current ? exportSetupDocument(config, current.id)! : { type: "deepseek" as const, model: "" }),
    name: current?.name,
  }))
  const [key, setKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [bodyText, setBodyText] = useState(() => current?.body ? JSON.stringify(current.body, null, 2) : "")
  const [bodyInvalid, setBodyInvalid] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
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
  const effectiveKey = draft.noApiKey ? undefined : key.trim() || matching?.apiKey?.trim()
  const hasCredentials = !!draft.noApiKey || !!effectiveKey
  const baseURL = resolveBaseURL({ provider: draft.type, baseURL: draft.baseURL })
  const canFetch = hasCredentials && !!baseURL
  const signature = JSON.stringify([draft.type, draft.api, draft.baseURL, matching?.headers, effectiveKey, draft.noApiKey])
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
      const result = await fetchProviderModels({ provider: draft.type, api: draft.api, baseURL: draft.baseURL, apiKey: draft.noApiKey ? undefined : key.trim() || latest?.apiKey, noApiKey: draft.noApiKey, headers: latest?.headers }, controller.signal)
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
  const bodyId = useId()
  const bodyHintId = `${bodyId}-hint`
  const bodyExampleId = `${bodyId}-example`
  const bodyErrorId = `${bodyId}-error`
  const api = resolveRequestApi({ provider: draft.type, api: draft.api })
  const bodyExample = JSON.stringify(draft.type === "deepseek" && api === "openai-chat"
    ? { thinking: { type: "disabled" } }
    : {
        "openai-responses": { reasoning: { effort: "low" } },
        "openai-chat": { reasoning_effort: "low" },
        "anthropic": { thinking: { type: "disabled" } },
        "gemini": { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } },
      }[api])
  const fieldClass = "settings-service-input"
  const labelClass = "text-xs font-medium"

  const save = async () => {
    setError(null)
    let body: SetupDocument["body"]
    try {
      body = bodyText.trim() ? setupDocumentSchema.shape.body.parse(JSON.parse(bodyText)) : undefined
    }
    catch {
      setBodyInvalid(true)
      bodyRef.current?.focus()
      return
    }
    setBodyInvalid(false)
    setBusy(true)
    onBusyChange(true)
    try {
      const document = setupDocumentSchema.parse({
        ...draft,
        body,
        name: draft.name?.trim() || undefined,
        baseURL: draft.baseURL?.trim() || undefined,
        apiKey: draft.noApiKey ? undefined : key.trim() || (matching ? draft.apiKey : undefined),
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
      className="settings-manual-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <fieldset disabled={busy} className="settings-service-fields">
        <div className="settings-service-field">
          <label className={labelClass} htmlFor={typeId}>{i18n.t("manualService.type")}</label>
          <div className="settings-service-input-wrap">
            <IconServer className="settings-service-field-icon" aria-hidden="true" />
            <SettingsSelect
              id={typeId}
              className="settings-service-input settings-service-with-icon"
              value={draft.type}
              disabled={busy}
              options={PROVIDER_TYPES.map(type => ({ value: type, label: type === "openai-compatible" ? i18n.t("manualService.compatible") : PROVIDER_ITEMS[type].name }))}
              onValueChange={(value) => {
                setDraft({ type: value as typeof draft.type, model: "", api: DEFAULT_REQUEST_API[value as typeof draft.type] })
                setKey("")
                setShowKey(false)
                setBodyText("")
                setBodyInvalid(false)
                onProviderChange(value as ProviderType)
              }}
            />
          </div>
        </div>
        <div className="settings-service-field">
          <label className={labelClass} htmlFor={nameId}>{i18n.t("manualService.name")}</label>
          <input id={nameId} className={fieldClass} value={draft.name ?? ""} onChange={event => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div className="settings-service-field settings-service-field-full">
          <label className={labelClass} htmlFor={urlId}>{i18n.t("manualService.url")}</label>
          <div className="settings-service-input-wrap">
            <IconLink className="settings-service-field-icon" aria-hidden="true" />
            <input id={urlId} className={`${fieldClass} settings-service-with-icon font-mono`} type="url" placeholder={baseURL} value={draft.baseURL ?? baseURL} onChange={event => setDraft({ ...draft, baseURL: event.target.value })} />
          </div>
        </div>
        <div className="settings-service-field settings-service-field-full">
          <div className="settings-service-field-top">
            <label className={labelClass} htmlFor={keyId}>{i18n.t("manualService.key")}</label>
            <label className="settings-service-key-choice">
              <input type="checkbox" checked={!!draft.noApiKey} onChange={event => setDraft({ ...draft, noApiKey: event.target.checked || undefined })} />
              {i18n.t("manualService.noApiKey")}
            </label>
          </div>
          <div className="settings-service-input-wrap">
            <IconKey className="settings-service-field-icon" aria-hidden="true" />
            <input id={keyId} className={`${fieldClass} settings-service-with-icon settings-service-key-input`} type={showKey ? "text" : "password"} autoComplete="off" disabled={!!draft.noApiKey} value={draft.noApiKey ? "" : key} placeholder={draft.noApiKey ? undefined : i18n.t(matching?.apiKey?.trim() ? "manualService.savedKeyPlaceholder" : "manualService.keyPlaceholder")} onChange={event => setKey(event.target.value)} />
            <button type="button" className="settings-service-key-visibility settings-service-icon-button" disabled={!!draft.noApiKey} aria-label={i18n.t(showKey ? "manualService.hideKey" : "manualService.showKey")} onClick={() => setShowKey(value => !value)}>
              {showKey ? <IconEyeOff aria-hidden="true" /> : <IconEye aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="settings-service-field settings-service-field-full">
          <label className={labelClass} htmlFor={modelId}>{i18n.t("manualService.model")}</label>
          <div className="settings-service-model-input">
            <div className="settings-service-input-wrap">
              <IconCpu className="settings-service-field-icon" aria-hidden="true" />
              <input id={modelId} className={`${fieldClass} settings-service-with-icon font-mono`} required value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} />
            </div>
            <Button type="button" variant="outline" className="settings-service-fetch" aria-label={i18n.t(modelState === "loading" ? "modelDiscovery.loading" : "modelDiscovery.fetch")} title={i18n.t("modelDiscovery.fetch")} disabled={!canFetch || modelState === "loading"} onClick={() => void fetchModels()}>
              <IconList aria-hidden="true" />
              {i18n.t(modelState === "loading" ? "modelDiscovery.loading" : "modelDiscovery.fetchShort")}
            </Button>
          </div>
          {(modelState === "failed" || modelState === "empty") && <p className="settings-service-model-feedback" role="status">{i18n.t(`modelDiscovery.${modelState}`)}</p>}
          {modelState === "list" && (
            <SettingsSelect
              id={modelsId}
              aria-label={i18n.t("modelDiscovery.select")}
              className="w-full"
              value={models.includes(draft.model) ? draft.model : ""}
              disabled={busy}
              options={[{ value: "", label: i18n.t("modelDiscovery.select"), disabled: true }, ...models.map(model => ({ value: model, label: model }))]}
              onValueChange={value => value && setDraft({ ...draft, model: value })}
            />
          )}
        </div>
        <div className="settings-service-field settings-service-field-full">
          <label className={labelClass} htmlFor={bodyId}>{i18n.t("manualService.body")}</label>
          <textarea
            ref={bodyRef}
            id={bodyId}
            className={`${fieldClass} settings-service-body font-mono`}
            rows={6}
            spellCheck={false}
            placeholder={bodyExample}
            value={bodyText}
            aria-invalid={bodyInvalid || undefined}
            aria-describedby={`${bodyHintId} ${bodyExampleId}${bodyInvalid ? ` ${bodyErrorId}` : ""}`}
            onChange={(event) => {
              setBodyText(event.target.value)
              setBodyInvalid(false)
            }}
          />
          <p id={bodyHintId} className="settings-service-body-help">{i18n.t("manualService.bodyHint")}</p>
          <p id={bodyExampleId} className="settings-service-body-help">
            {i18n.t("manualService.bodyExample")}
            <br />
            <code>{bodyExample}</code>
          </p>
          {bodyInvalid && <p id={bodyErrorId} className="settings-service-body-error" role="alert">{i18n.t("manualService.bodyInvalid")}</p>}
        </div>
        {error && (
          <div role="alert" className="settings-service-form-error settings-service-field-full">
            <p>{i18n.t("options.service.failedNotSaved")}</p>
            <pre>{error}</pre>
          </div>
        )}
        {!current && <div className="settings-service-field-full"><UseAfterAdd value={makeCurrent} onChange={onMakeCurrentChange} disabled={busy} /></div>}
        <div className="settings-service-form-actions settings-service-field-full">
          {onCancel && <Button type="button" variant="outline" onClick={onCancel}>{i18n.t("options.service.cancel")}</Button>}
          <Button type="submit" disabled={!draft.model.trim() || !hasCredentials}>{busy ? i18n.t("options.service.applying") : i18n.t(current ? "options.service.checkSave" : "options.service.checkAdd")}</Button>
        </div>
      </fieldset>
    </form>
  )
}
