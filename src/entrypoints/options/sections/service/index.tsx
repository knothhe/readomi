import type { ConnectionCheck, ProviderConfig } from "@/types/config/provider"
import type { SetupPreview } from "@/utils/setup-document"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useEffect, useMemo, useRef, useState } from "react"
import { i18n } from "#imports"
import { IconCheck, IconCopy } from "@/components/icons"
import { SegmentedControl } from "@/components/segmented-control"
import { Button } from "@/components/ui/button"
import { configAtom } from "@/utils/atoms/config"
import { removeProviderAtom, saveProviderAtom, saveProviderCheckAtom, selectProviderAtom } from "@/utils/atoms/service"
import { clearClipboard, copyText } from "@/utils/clipboard"
import { deepEqual } from "@/utils/object"
import { resolveBaseURL, resolveRequestApi } from "@/utils/providers/request"
import { checkConnection } from "@/utils/providers/test-connection"
import { formatRelativeTime } from "@/utils/relative-time"
import { buildAgentInstructions } from "@/utils/setup-agent-instructions"
import { applySetupDocument, describeSetupDocument, exportSetupDocument, maskApiKey, parseSetupDocument, stringifySetupDocument } from "@/utils/setup-document"
import { cn } from "@/utils/styles/utils"
import { getUILocale } from "@/utils/ui-language"
import { ManualServiceForm } from "./manual-form"
import { SortableServiceList } from "./sortable-service-list"
import { UseAfterAdd } from "./use-after-add"
import "./style.css"

const COPIED_FEEDBACK_MS = 2000
const MONO = "font-mono text-xs text-muted-foreground"

/** See design/Settings-Multi-Service*.html for the list and editor states. */
export function ServiceSection() {
  const config = useAtomValue(configAtom)
  const providers = config.providersConfig.filter(provider => provider.apiKey?.trim())
  const [editing, setEditing] = useState<string | null>(() => providers.length ? null : "add")
  const [editorMode, setEditorMode] = useState<"manual" | "agent">("manual")
  const [busy, setBusy] = useState(false)
  const [makeCurrent, setMakeCurrent] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const current = editing && editing !== "add" ? config.providersConfig.find(provider => provider.id === editing) : undefined
  const showingEditor = editing === "add" || !!current
  const close = () => {
    setEditing(null)
    setFeedback(null)
  }
  const openEditor = (id: string) => {
    setEditorMode("manual")
    setMakeCurrent(false)
    setFeedback(null)
    setEditing(id)
  }

  return (
    <section id="service" className="settings-section settings-service">
      {showingEditor && (
        <button type="button" className="settings-service-back" disabled={busy} onClick={close}>
          <span aria-hidden="true">‹</span>
          {" "}
          {i18n.t("options.service.back")}
        </button>
      )}
      <div className="settings-service-page-heading">
        <h1 className="settings-page-title">{!showingEditor ? i18n.t("options.service.title") : current ? i18n.t("options.service.editTitle", [current.name]) : i18n.t("options.service.add")}</h1>
        {!showingEditor && (
          <button type="button" className="settings-service-add" onClick={() => openEditor("add")}>
            <span aria-hidden="true">＋</span>
            {i18n.t("options.service.add")}
          </button>
        )}
      </div>
      {!showingEditor
        ? (
            <div className="settings-service-content">
              <SortableServiceList providers={providers}>
                {provider => <ServiceRow provider={provider} active={provider.id === config.translate.providerId} onEdit={() => openEditor(provider.id)} onFeedback={setFeedback} />}
              </SortableServiceList>
              <p className="settings-service-scope">{i18n.t("options.service.scope")}</p>
              {feedback && <p role="status" className="settings-service-feedback">{feedback}</p>}
            </div>
          )
        : (
            <div>
              <div className="settings-service-card">
                <div className="settings-service-editor flex flex-col gap-5">
                  <div className="settings-service-editor-top">
                    <SegmentedControl
                      aria-label={i18n.t("options.service.configMethod")}
                      size="sm"
                      className="settings-service-method"
                      value={editorMode}
                      options={[{ value: "manual", label: i18n.t("manualService.manual") }, { value: "agent", label: i18n.t("manualService.agent") }]}
                      onChange={value => !busy && setEditorMode(value)}
                    />
                    {editorMode === "agent" && <CopyInstructionsButton providerId={current?.id ?? null} />}
                  </div>
                  {editorMode === "manual"
                    ? <ManualServiceForm key={editing} current={current} makeCurrent={makeCurrent} onMakeCurrentChange={providers.length ? setMakeCurrent : undefined} onBusyChange={setBusy} onDone={close} onCancel={close} />
                    : <ServiceEditor key={editing} current={current} makeCurrent={makeCurrent} onMakeCurrentChange={providers.length ? setMakeCurrent : undefined} onBusyChange={setBusy} onDone={close} />}
                </div>
              </div>
              <p className="settings-service-scope">{i18n.t("options.service.saveHint")}</p>
            </div>
          )}
    </section>
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

function CopyInstructionsButton({ providerId }: { providerId: string | null }) {
  const store = useStore()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (await copyText(buildAgentInstructions(store.get(configAtom), providerId))) {
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

function ServiceRow({ provider, active, onEdit, onFeedback }: { provider: ProviderConfig, active: boolean, onEdit: () => void, onFeedback: (message: string) => void }) {
  const select = useSetAtom(selectProviderAtom)
  const remove = useSetAtom(removeProviderAtom)
  const saveCheck = useSetAtom(saveProviderCheckAtom)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [now] = useState(Date.now)
  const status = checkStatus(provider.connectionCheck, Math.max(now, provider.connectionCheck?.checkedAt ?? now))

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && menuRef.current)
        menuRef.current.open = false
    }
    document.addEventListener("pointerdown", closeOutside)
    return () => document.removeEventListener("pointerdown", closeOutside)
  }, [])

  const act = async (operation: "use" | "test" | "remove") => {
    setBusy(true)
    setTesting(operation === "test")
    if (menuRef.current)
      menuRef.current.open = false
    try {
      if (operation === "use") {
        await select(provider.id)
        onFeedback(i18n.t("popup.serviceSwitch.switched", [provider.name]))
      }
      else if (operation === "remove") {
        await remove(provider.id)
        onFeedback(i18n.t("options.service.removed", [provider.name]))
      }
      else {
        const check = await checkConnection(provider)
        await saveCheck({ provider, check })
      }
    }
    catch {
      onFeedback(i18n.t("options.service.saveFailed"))
    }
    finally {
      setBusy(false)
      setTesting(false)
    }
  }

  return (
    <article className="settings-service-row" data-current={active}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={`${provider.name} · ${provider.model}`}
        tabIndex={active ? 0 : -1}
        disabled={!provider.enabled}
        aria-disabled={busy || !provider.enabled}
        className="settings-service-choose"
        onClick={() => !busy && !active && void act("use")}
      >
        <span className="settings-service-radio" aria-hidden="true" />
        <span className="settings-service-name-line">
          <span role="heading" aria-level={2} title={provider.name}>{provider.name}</span>
          {active && <span className="settings-service-badge">{i18n.t("options.service.label.current")}</span>}
        </span>
        <span className="settings-service-model" title={provider.model}>{provider.model}</span>
      </button>
      <div className="settings-service-row-end">
        <span className={cn("settings-service-status", testing ? "text-muted-foreground" : status.tone)} data-testid="service-status" aria-live="polite" title={status.when ?? undefined}>
          <Dot className={testing ? "bg-muted-foreground/50" : status.dot} />
          {testing ? i18n.t("options.service.testing") : status.label}
        </span>
        <details
          ref={menuRef}
          className="settings-service-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false
              event.currentTarget.querySelector("summary")?.focus()
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault()
              event.currentTarget.open = true
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length
              buttons[next]?.focus()
            }
          }}
        >
          <summary aria-label={i18n.t("options.service.actions", [provider.name])}><span aria-hidden="true">•••</span></summary>
          <div className="settings-service-menu-panel">
            <button type="button" disabled={busy} onClick={onEdit}>{i18n.t("options.service.edit")}</button>
            <button type="button" disabled={busy} onClick={() => void act("test")}>{i18n.t("options.service.test")}</button>
            <button
              type="button"
              aria-expanded={showDetails}
              aria-controls={`service-details-${provider.id}`}
              onClick={() => {
                setShowDetails(value => !value)
                if (menuRef.current)
                  menuRef.current.open = false
              }}
            >
              {i18n.t("options.service.connectionDetails")}
            </button>
            <div className="settings-service-menu-separator" />
            <button type="button" className="text-destructive" disabled={busy || active} title={active ? i18n.t("options.service.removeCurrentHint") : undefined} onClick={() => void act("remove")}>{i18n.t("options.service.remove")}</button>
          </div>
        </details>
      </div>
      {showDetails && (
        <details id={`service-details-${provider.id}`} className="settings-service-connection" open onToggle={event => !event.currentTarget.open && setShowDetails(false)}>
          <summary>{i18n.t("options.service.connectionDetails")}</summary>
          <dl>
            <dt>{i18n.t("manualService.url")}</dt>
            <dd>{resolveBaseURL(provider) || "—"}</dd>
            <dt>{i18n.t("manualService.key")}</dt>
            <dd>{provider.apiKey ? maskApiKey(provider.apiKey) : "—"}</dd>
            <dt>{i18n.t("manualService.type")}</dt>
            <dd>{provider.provider}</dd>
            <dt>{i18n.t("manualService.api")}</dt>
            <dd>{resolveRequestApi(provider)}</dd>
            <dt>{i18n.t("options.service.label.connection")}</dt>
            <dd>{[status.label, status.when].filter(Boolean).join(" · ")}</dd>
          </dl>
          {provider.connectionCheck?.error && <code className="settings-service-error">{provider.connectionCheck.error}</code>}
        </details>
      )}
    </article>
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

function ServiceEditor({ current, makeCurrent, onMakeCurrentChange, onBusyChange, onDone }: { current: ProviderConfig | undefined, makeCurrent: boolean, onMakeCurrentChange?: (value: boolean) => void, onBusyChange: (value: boolean) => void, onDone: () => void }) {
  const store = useStore()
  const config = useAtomValue(configAtom)
  const saveProvider = useSetAtom(saveProviderAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // The editor opens on the current service, masked, so a field can be changed in place.
  const [initial] = useState(() => {
    const exported = current ? exportSetupDocument(config, current?.id) : null
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
  const unchanged = !!current && !!parsed?.ok && deepEqual(parsed.document, exportSetupDocument(config, current?.id))
  const preview = parsed?.ok && !unchanged ? describeSetupDocument(config, parsed.document, { mode: current ? "edit" : "add", providerId: current?.id, makeCurrent }) : null
  const canApply = !!preview && preview.keyStatus !== "missing" && !applying

  const apply = async () => {
    if (!parsed?.ok)
      return
    setApplying(true)
    onBusyChange(true)
    setFailure(null)
    try {
      const { config: next, providerId } = applySetupDocument(store.get(configAtom), parsed.document, { mode: current ? "edit" : "add", providerId: current?.id, makeCurrent })
      const provider = next.providersConfig.find(p => p.id === providerId)!
      const check = await checkConnection(provider)
      if (!check.ok) {
        setFailure(check.error ?? "")
        return
      }
      await saveProvider({ provider: { ...provider, connectionCheck: check }, mode: current ? "edit" : "add", makeCurrent })
      await clearClipboard()
      if (mountedRef.current)
        onDone()
    }
    catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
    finally {
      setApplying(false)
      onBusyChange(false)
    }
  }

  const rows = Math.max(5, text.split("\n").length)

  return (
    <>
      <p className="m-0 text-xs leading-[18px] text-muted-foreground">{i18n.t("options.service.agentHint")}</p>
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
        className="settings-service-document w-full resize-y rounded-lg border border-input bg-card px-3 py-[11px] font-mono text-xs leading-[18px] outline-none selection:bg-link/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-60"
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
        <Labeled label={i18n.t(current ? "options.service.label.after" : "options.service.addPreview")}>
          <NameAndModel name={preview.providerName} model={preview.modelId} size="text-[13px]" />
          {preview.keyStatus === "missing"
            ? <span className="text-xs text-destructive">{i18n.t("options.service.keyMissing")}</span>
            : <Details parts={previewDetails(preview)} />}
        </Labeled>
      )}
      {!current && <UseAfterAdd value={makeCurrent} onChange={onMakeCurrentChange} disabled={applying} />}
      {current && <p className="text-[11px] text-muted-foreground">{i18n.t("options.service.editHint")}</p>}
      {failure !== null && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 text-xs">
          <p className="font-medium text-destructive">{i18n.t(current ? "options.service.failedNotSaved" : "options.service.failedAdd")}</p>
          {failure && <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-xs leading-[17px] text-muted-foreground">{failure}</code>}
          {!current && <p className="mt-1 text-muted-foreground">{i18n.t("options.service.draftKept")}</p>}
        </div>
      )}
      <div className="settings-service-edit-actions flex items-center gap-2 pt-1">
        <Button variant="outline" className="px-3.5 text-[13px] font-normal" disabled={applying} onClick={onDone}>
          {i18n.t("options.service.cancel")}
        </Button>
        <Button className="px-4 text-[13px] font-semibold" disabled={!canApply} onClick={() => void apply()}>
          {applying ? i18n.t("options.service.applying") : i18n.t(current ? "options.service.checkSave" : failure !== null ? "options.service.retryAdd" : "options.service.checkAdd")}
        </Button>
      </div>
    </>
  )
}
