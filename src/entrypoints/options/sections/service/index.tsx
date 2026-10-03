import type { ConnectionCheck, ProviderConfig } from "@/types/config/provider"
import type { SetupPreview } from "@/utils/setup-document"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useEffect, useMemo, useRef, useState } from "react"
import { i18n } from "#imports"
import { IconArrowRight, IconCheck, IconCopy } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { configAtom, writeConfigAtom } from "@/utils/atoms/config"
import { clearClipboard, copyText } from "@/utils/clipboard"
import { deepEqual } from "@/utils/object"
import { getRequestHost, resolveBaseURL, resolveRequestApi } from "@/utils/providers/request"
import { checkConnection, withConnectionCheck } from "@/utils/providers/test-connection"
import { formatRelativeTime } from "@/utils/relative-time"
import { buildAgentInstructions } from "@/utils/setup-agent-instructions"
import { applySetupDocument, describeSetupDocument, describesThinkingOff, exportSetupDocument, maskApiKey, parseSetupDocument, stringifySetupDocument } from "@/utils/setup-document"
import { cn } from "@/utils/styles/utils"
import { getUILocale } from "@/utils/ui-language"
import { SettingsSection } from "../../components/settings-section"
import { ManualServiceForm } from "./manual-form"

const COPIED_FEEDBACK_MS = 2000
const MONO = "font-mono text-xs text-muted-foreground"

/*
 * The translation service is a preview by default. The editor appears in
 * place only when it is needed: right away while no service is configured,
 * otherwise after "Agent setup" or "Edit". Its text is the service part of
 * a setup document; applying it first checks the connection and saves only when that works,
 * so a failed attempt never replaces the service in use. See
 * design/Service-States.html.
 */
export function ServiceSection() {
  const config = useAtomValue(configAtom)
  const active = config.providersConfig.find(p => p.id === config.translate.providerId)
  const configured = !!active?.apiKey?.trim()
  const [editorMode, setEditorMode] = useState<"manual" | "agent" | null>(null)
  const agentEditing = editorMode === "agent" || (!configured && editorMode === null)
  const showingPreview = configured && active && !agentEditing && editorMode !== "manual"
  const methodClass = "aria-pressed:border-brand aria-pressed:bg-secondary aria-pressed:text-foreground"

  return (
    <SettingsSection id="service" title={i18n.t("options.service.title")}>
      <div className="flex flex-col gap-6">
        {showingPreview && <ServicePreview provider={active} onEdit={() => setEditorMode("agent")} />}
        <div className="flex flex-col gap-3">
          <h3 hidden={!showingPreview} className="text-sm font-semibold">{i18n.t("options.service.reconfigure")}</h3>
          <div className={cn("settings-setup-options", showingPreview ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "flex flex-wrap gap-2")}>
            <Button variant="outline" className={cn(methodClass, showingPreview && "settings-setup-option h-auto min-h-[66px] justify-between rounded-xl px-5 py-4 text-[13px]")} aria-pressed={editorMode === "manual"} onClick={() => setEditorMode("manual")}>
              <span className="inline-flex items-center gap-3">
                {showingPreview && <SetupIcon method="manual" />}
                {i18n.t("manualService.manual")}
              </span>
              {showingPreview && <IconArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />}
            </Button>
            <Button variant="outline" className={cn(methodClass, showingPreview && "settings-setup-option h-auto min-h-[66px] justify-between rounded-xl px-5 py-4 text-[13px]")} aria-pressed={agentEditing} onClick={() => setEditorMode("agent")}>
              <span className="inline-flex items-center gap-3">
                {showingPreview && <SetupIcon method="agent" />}
                {i18n.t("manualService.agent")}
              </span>
              {showingPreview && <IconArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />}
            </Button>
          </div>
        </div>
        {!showingPreview && (
          <div className="settings-service-editor flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
            {editorMode === "manual"
              ? <ManualServiceForm onDone={() => setEditorMode(null)} onCancel={configured ? () => setEditorMode(null) : undefined} />
              : <ServiceEditor current={configured ? active : undefined} onDone={() => setEditorMode(null)} />}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}

function SetupIcon({ method }: { method: "manual" | "agent" }) {
  return (
    <svg className="size-6 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={method === "manual" ? "m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18" : "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"} />
    </svg>
  )
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-1.5 shrink-0 rounded-full", className)} />
}

function Details({ parts }: { parts: string[] }) {
  return <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>
}

function NameAndModel({ name, model, size = "text-sm" }: { name: string, model: string, size?: string }) {
  return (
    <div className="min-w-0 truncate">
      <span className={cn("font-semibold", size)}>{name}</span>
      {model && <span className={cn("ml-2", MONO)}>{model}</span>}
    </div>
  )
}

function CopyInstructionsButton() {
  const store = useStore()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (await copyText(buildAgentInstructions(store.get(configAtom)))) {
      setCopied(true)
      setTimeout(setCopied, COPIED_FEEDBACK_MS, false)
    }
  }
  return (
    <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
      {copied ? <IconCheck className="size-3.5" aria-hidden="true" /> : <IconCopy className="size-3.5" aria-hidden="true" />}
      {copied ? i18n.t("options.service.copied") : i18n.t("options.service.copyInstructions")}
    </button>
  )
}

/* ──────────────────────────────
  Preview
  ────────────────────────────── */

function checkStatus(check: ConnectionCheck | undefined, now: number) {
  const locale = getUILocale()
  if (!check)
    return { dot: "bg-muted-foreground/50", tone: "text-muted-foreground", label: i18n.t("options.service.status.unchecked"), when: null }
  const when = i18n.t("options.service.checkedAt", [formatRelativeTime(check.checkedAt, now, locale)])
  return check.ok
    ? { dot: "bg-success", tone: "text-success", label: i18n.t("options.service.status.ok"), when }
    : { dot: "bg-destructive", tone: "text-destructive", label: i18n.t("options.service.status.failed"), when }
}

function ServicePreview({ provider, onEdit }: { provider: ProviderConfig, onEdit: () => void }) {
  const store = useStore()
  const setConfig = useSetAtom(writeConfigAtom)
  const [testing, setTesting] = useState(false)
  // Read once per mount; "2 hours ago" does not need to tick while the page is open.
  const [now] = useState(Date.now)
  const status = checkStatus(provider.connectionCheck, provider.connectionCheck ? Math.max(now, provider.connectionCheck.checkedAt) : now)

  const test = async () => {
    setTesting(true)
    try {
      const check = await checkConnection(provider)
      await setConfig({ providersConfig: withConnectionCheck(store.get(configAtom), provider.id, check).providersConfig })
    }
    finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-service-grid grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(250px,.85fr)]">
      <div className="settings-service-summary min-w-0 rounded-2xl border border-border bg-card p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="grid size-[43px] place-items-center rounded-xl border border-border bg-secondary text-brand">
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="4" width="16" height="6" rx="2" />
              <rect x="4" y="14" width="16" height="6" rx="2" />
              <path d="M7 7h.01M7 17h.01M12 7h5M12 17h5" />
            </svg>
          </div>
          <div className={cn("inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1.5 text-[11px]", testing ? "text-muted-foreground" : status.tone)} data-testid="service-status">
            <Dot className={testing ? "bg-muted-foreground/50" : status.dot} />
            <span>{testing ? i18n.t("options.service.testing") : status.label}</span>
          </div>
        </div>
        <h3 className="mt-5 break-words text-[23px] font-semibold tracking-[-.7px]">{provider.name}</h3>
        <p className="settings-service-model mt-1.5 break-words font-serif text-[35px] leading-[1.25] tracking-[-1px]">{provider.model}</p>
        <div className="mt-5 flex flex-wrap gap-1.5">
          {describesThinkingOff(provider.body, resolveRequestApi(provider)) && <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">{i18n.t("options.service.thinkingOff")}</span>}
          {provider.apiKey && <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">{i18n.t("options.service.key", [maskApiKey(provider.apiKey)])}</span>}
        </div>
        <div className="mt-6 flex flex-col gap-2 border-t border-border pt-5">
          <p className="text-[11px] text-muted-foreground">{i18n.t("options.service.sendsTo", [getRequestHost(provider)])}</p>
          <p className="break-all font-mono text-xs">{resolveBaseURL(provider)}</p>
          {!testing && status.when && <p className="text-[11px] text-muted-foreground">{status.when}</p>}
        </div>
        {!testing && provider.connectionCheck?.error && (
          <code className="mt-3 block whitespace-pre-wrap break-all font-mono text-xs leading-[17px] text-muted-foreground">{provider.connectionCheck.error}</code>
        )}
        <div className="mt-6 flex gap-2.5">
          <Button className="px-3.5 text-xs font-normal" disabled={testing} onClick={() => void test()}>
            {i18n.t("options.service.test")}
          </Button>
          <Button variant="outline" className="px-3.5 text-xs font-normal" disabled={testing} onClick={onEdit}>
            {i18n.t("options.service.edit")}
          </Button>
        </div>
      </div>
      <aside className="settings-service-info min-w-0 rounded-2xl border border-border bg-background/50 p-6">
        <h3 className="mb-6 text-[13px] font-semibold">{i18n.t("options.service.connectionDetails")}</h3>
        <dl className="flex flex-col gap-4">
          <ConnectionDetail label={i18n.t("manualService.type")} value={provider.provider} />
          <ConnectionDetail label={i18n.t("manualService.api")} value={resolveRequestApi(provider)} />
          <ConnectionDetail label={i18n.t("manualService.key")} value={provider.apiKey ? maskApiKey(provider.apiKey) : "—"} />
        </dl>
      </aside>
    </div>
  )
}

function ConnectionDetail({ label, value }: { label: string, value: string }) {
  return (
    <div className="border-b border-border pb-4 last:border-0 last:pb-0">
      <dt className="mb-2 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="m-0 break-all font-mono text-xs">{value}</dd>
    </div>
  )
}

/* ──────────────────────────────
  Editor
  ────────────────────────────── */

function Labeled({ label, tone, children }: { label: string, tone?: string, children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-baseline gap-3">
      <span className={cn("text-xs text-muted-foreground", tone)}>{label}</span>
      <div className="flex min-w-0 flex-col gap-[3px]">{children}</div>
    </div>
  )
}

function previewDetails(preview: SetupPreview): string[] {
  const parts = [i18n.t("options.service.sendsTo", [preview.host || "—"])]
  if (preview.keyStatus === "new")
    parts.push(i18n.t("options.service.newKey"))
  else if (preview.keyStatus === "reused")
    parts.push(i18n.t("options.service.keptKey"))
  if (preview.thinkingOff)
    parts.push(i18n.t("options.service.thinkingOff"))
  return parts
}

function ServiceEditor({ current, onDone }: { current: ProviderConfig | undefined, onDone: () => void }) {
  const store = useStore()
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(writeConfigAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // The editor opens on the current service, masked, so a field can be changed in place.
  const [initial] = useState(() => {
    const exported = current ? exportSetupDocument(config) : null
    return exported ? stringifySetupDocument(exported) : ""
  })
  const [text, setText] = useState(initial)
  const [applying, setApplying] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // A first setup shows the preview as soon as the service is saved, which
  // unmounts this editor before apply() returns. Closing then would close an
  // editor the reader has opened again since.
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea)
      return
    textarea.focus()
    // Selected, so pasting what the agent put on the clipboard replaces it whole.
    if (initial)
      textarea.select()
  }, [initial])

  const parsed = useMemo(() => text.trim() ? parseSetupDocument(text) : null, [text])
  const unchanged = !!current && !!parsed?.ok && deepEqual(parsed.document, exportSetupDocument(config))
  const preview = parsed?.ok && !unchanged ? describeSetupDocument(config, parsed.document) : null
  const canApply = !!preview && preview.keyStatus !== "missing" && !applying

  const apply = async () => {
    if (!parsed?.ok)
      return
    setApplying(true)
    setFailure(null)
    try {
      const { config: next, providerId } = applySetupDocument(store.get(configAtom), parsed.document)
      const provider = next.providersConfig.find(p => p.id === providerId)!
      const check = await checkConnection(provider)
      if (!check.ok) {
        setFailure(check.error ?? "")
        return
      }
      const saved = withConnectionCheck(next, providerId, check)
      await setConfig({ providersConfig: saved.providersConfig, translate: saved.translate })
      await clearClipboard()
      if (mountedRef.current)
        onDone()
    }
    catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
    finally {
      setApplying(false)
    }
  }

  const rows = Math.max(5, text.split("\n").length)

  return (
    <>
      {current
        ? (
            <Labeled label={i18n.t("options.service.label.current")}>
              <NameAndModel name={current.name} model={current.model} size="text-[13px]" />
            </Labeled>
          )
        : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Dot className="bg-attention" />
                {i18n.t("options.service.empty.title")}
              </div>
              <p className="m-0 text-xs leading-[18px] text-muted-foreground">{i18n.t("options.service.empty.description")}</p>
            </div>
          )}
      <textarea
        ref={textareaRef}
        aria-label={i18n.t("options.service.editorLabel")}
        value={text}
        spellCheck={false}
        disabled={applying}
        placeholder={i18n.t("options.service.placeholder")}
        style={{ height: `${rows * 18 + 24}px` }}
        onChange={(event) => {
          setText(event.target.value)
          setFailure(null)
        }}
        className="w-full resize-y rounded-lg border border-input bg-card px-3 py-[11px] font-mono text-xs leading-[18px] outline-none selection:bg-link/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-60"
      />
      {parsed && !parsed.ok && (
        <Labeled label={i18n.t("options.service.label.after")} tone="text-destructive">
          <pre className="m-0 whitespace-pre-wrap font-sans text-xs leading-[17px] text-destructive">{parsed.error}</pre>
        </Labeled>
      )}
      {unchanged && (
        <Labeled label={i18n.t("options.service.label.after")}>
          <span className="text-xs text-muted-foreground">{i18n.t("options.service.unchanged")}</span>
        </Labeled>
      )}
      {preview && (
        <Labeled label={i18n.t("options.service.label.after")}>
          <NameAndModel name={preview.providerName} model={preview.modelId} size="text-[13px]" />
          {preview.keyStatus === "missing"
            ? <span className="text-xs text-destructive">{i18n.t("options.service.keyMissing")}</span>
            : <Details parts={previewDetails(preview)} />}
        </Labeled>
      )}
      {failure !== null && (
        <Labeled label={i18n.t("options.service.label.connection")}>
          <div className="flex items-center gap-1.5 text-[13px] text-destructive">
            <Dot className="bg-destructive" />
            {i18n.t("options.service.failedNotSaved")}
          </div>
          {failure && <code className="block whitespace-pre-wrap font-mono text-xs leading-[17px] text-muted-foreground">{failure}</code>}
        </Labeled>
      )}
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1"><CopyInstructionsButton /></div>
        {current && (
          <Button variant="outline" className="px-3.5 text-[13px] font-normal" disabled={applying} onClick={onDone}>
            {i18n.t("options.service.cancel")}
          </Button>
        )}
        <Button className="px-4 text-[13px] font-semibold" disabled={!canApply} onClick={() => void apply()}>
          {applying ? i18n.t("options.service.applying") : i18n.t("options.service.apply")}
        </Button>
      </div>
    </>
  )
}
