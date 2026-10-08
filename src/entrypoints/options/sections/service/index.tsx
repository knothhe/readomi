import type { NotifyService, ServiceFeedback } from "./service-notice"
import type { ProviderConfig, ProviderType } from "@/types/config/provider"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { i18n } from "#imports"
import { IconArrowLeft, IconBolt, IconCheck, IconCode, IconCopy, IconDots, IconPencil, IconPlus, IconTrash } from "@/components/icons"
import { SegmentedControl } from "@/components/segmented-control"
import { Button } from "@/components/ui/button"
import { configAtom } from "@/utils/atoms/config"
import { removeProviderAtom, saveProviderAtom, saveProviderCheckAtom, selectProviderAtom } from "@/utils/atoms/service"
import { clearClipboard, copyText } from "@/utils/clipboard"
import { deepEqual } from "@/utils/object"
import { checkConnection } from "@/utils/providers/test-connection"
import { hasProviderCredentials, initialProviderPlaceholder, isProviderReady } from "@/utils/service-management"
import { buildAgentInstructions } from "@/utils/setup-agent-instructions"
import { applySetupDocument, describeSetupDocument, exportSetupDocument, parseSetupDocument, stringifySetupDocument } from "@/utils/setup-document"
import { ManualServiceForm } from "./manual-form"
import { ServiceMark } from "./service-mark"
import { ServiceNotice } from "./service-notice"
import { SortableServiceList } from "./sortable-service-list"
import { UseAfterAdd } from "./use-after-add"
import "./style.css"

const COPIED_FEEDBACK_MS = 2000

/** design/Settings-Service-A-Refined*.html is the source for this section. */
export function ServiceSection() {
  const config = useAtomValue(configAtom)
  const placeholder = initialProviderPlaceholder(config)
  const providers = config.providersConfig.filter(provider => provider.id !== placeholder?.id)
  const [editing, setEditing] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<"manual" | "agent">("manual")
  const [editorProvider, setEditorProvider] = useState<ProviderType>("deepseek")
  const [busy, setBusy] = useState(false)
  const [makeCurrent, setMakeCurrent] = useState(false)
  const [feedback, setFeedback] = useState<ServiceFeedback | null>(null)
  const nextFeedbackIdRef = useRef(0)
  const notify: NotifyService = useCallback(next => setFeedback({ ...next, id: ++nextFeedbackIdRef.current }), [])
  const dismissFeedback = useCallback(() => setFeedback(null), [])
  const current = editing && editing !== "add" ? config.providersConfig.find(provider => provider.id === editing) : undefined
  const showingEditor = editing === "add" || !!current || !providers.length || busy
  const close = () => {
    setEditing(null)
    setFeedback(null)
  }
  const saved = () => {
    close()
    notify({ kind: "success", message: i18n.t("options.service.saved") })
  }
  const openEditor = (id: string) => {
    setEditorMode("manual")
    setEditorProvider(config.providersConfig.find(provider => provider.id === id)?.provider ?? "deepseek")
    setMakeCurrent(false)
    setFeedback(null)
    setEditing(id)
  }

  return (
    <section id="service" className="settings-section settings-service" data-editor={showingEditor}>
      {showingEditor && (
        <button type="button" className="settings-service-back" disabled={busy} onClick={close}>
          <IconArrowLeft aria-hidden="true" />
          {i18n.t("options.service.back")}
        </button>
      )}
      <div className="settings-service-page-heading">
        <div className="settings-service-title">
          {showingEditor && <ServiceMark provider={editorProvider} />}
          <h1 className="settings-page-title">{!showingEditor ? i18n.t("options.service.title") : current ? i18n.t("options.service.editTitle", [current.name]) : i18n.t("options.service.add")}</h1>
        </div>
        {!showingEditor && (
          <button type="button" className="settings-service-add" onClick={() => openEditor("add")}>
            <IconPlus aria-hidden="true" />
            {i18n.t("options.service.add")}
          </button>
        )}
      </div>
      {!showingEditor
        ? (
            <div className="settings-service-content">
              <SortableServiceList providers={providers}>
                {provider => <ServiceRow provider={provider} active={provider.id === config.translate.providerId} onEdit={() => openEditor(provider.id)} onFeedback={notify} />}
              </SortableServiceList>
            </div>
          )
        : (
            <div className="settings-service-editor">
              <div className="settings-service-editor-top">
                <SegmentedControl
                  aria-label={i18n.t("options.service.configMethod")}
                  size="sm"
                  className="settings-service-method"
                  value={editorMode}
                  options={[
                    { value: "manual", label: (
                      <span>
                        <IconPencil aria-hidden="true" />
                        {i18n.t("manualService.manual")}
                      </span>
                    ) },
                    { value: "agent", label: (
                      <span>
                        <IconCode aria-hidden="true" />
                        {i18n.t("manualService.agent")}
                      </span>
                    ) },
                  ]}
                  onChange={value => !busy && setEditorMode(value)}
                />
              </div>
              {editorMode === "manual"
                ? <ManualServiceForm key={editing} current={current} makeCurrent={makeCurrent} onMakeCurrentChange={providers.length ? setMakeCurrent : undefined} onBusyChange={setBusy} onDone={saved} onCancel={close} onProviderChange={setEditorProvider} />
                : (
                    <>
                      <div className="settings-service-agent-heading">
                        <span>{i18n.t("options.service.editorLabel")}</span>
                        <CopyInstructionsButton providerId={current?.id ?? null} />
                      </div>
                      <ServiceEditor key={editing} current={current} makeCurrent={makeCurrent} onMakeCurrentChange={providers.length ? setMakeCurrent : undefined} onBusyChange={setBusy} onDone={saved} onCancel={close} />
                    </>
                  )}
            </div>
          )}
      <ServiceNotice feedback={feedback} onDismiss={dismissFeedback} />
    </section>
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
    <button type="button" onClick={() => void copy()} className="settings-service-copy">
      {copied ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />}
      {copied ? i18n.t("options.service.copied") : i18n.t("options.service.copyInstructions")}
    </button>
  )
}

function ServiceRow({ provider, active, onEdit, onFeedback }: { provider: ProviderConfig, active: boolean, onEdit: () => void, onFeedback: NotifyService }) {
  const store = useStore()
  const select = useSetAtom(selectProviderAtom)
  const remove = useSetAtom(removeProviderAtom)
  const saveCheck = useSetAtom(saveProviderCheckAtom)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [busy, setBusy] = useState(false)
  const ready = isProviderReady(provider)

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && menuRef.current)
        menuRef.current.open = false
    }
    document.addEventListener("pointerdown", closeOutside)
    return () => document.removeEventListener("pointerdown", closeOutside)
  }, [])

  const act = async (operation: "use" | "test" | "remove") => {
    // Retry uses the latest saved credentials, including edits from another page.
    const latest = store.get(configAtom).providersConfig.find(candidate => candidate.id === provider.id)
    if (!latest)
      return
    setBusy(true)
    if (menuRef.current)
      menuRef.current.open = false
    if (operation === "test")
      onFeedback({ kind: "testing", message: `${latest.name} · ${i18n.t("options.service.testing")}` })
    try {
      if (operation === "use") {
        await select(provider.id)
      }
      else if (operation === "remove") {
        await remove(provider.id)
        onFeedback({ kind: "success", message: i18n.t("options.service.removed", [latest.name]) })
      }
      else {
        const check = await checkConnection(latest)
        await saveCheck({ provider: latest, check })
        onFeedback({ kind: check.ok ? "success" : "error", message: `${latest.name} · ${i18n.t(check.ok ? "options.service.testPassed" : "options.service.testFailed")}`, description: check.error, retry: check.ok ? undefined : () => void act("test") })
      }
    }
    catch (error) {
      onFeedback({ kind: "error", message: i18n.t("options.service.saveFailed"), description: error instanceof Error ? error.message : undefined, retry: operation === "test" ? () => void act("test") : undefined })
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <article className="settings-service-row" data-current={active}>
      <button type="button" role="radio" aria-checked={active} aria-label={`${provider.name} · ${provider.model}`} tabIndex={active ? 0 : -1} disabled={!ready} aria-disabled={busy || !ready} className="settings-service-choose" onClick={() => !busy && !active && void act("use")}>
        <ServiceMark provider={provider.provider} />
        <span className="settings-service-row-copy">
          <span className="settings-service-name-line">
            <span role="heading" aria-level={2} title={provider.name}>{provider.name}</span>
            {active && <span className="settings-service-badge">{i18n.t("options.service.label.current")}</span>}
          </span>
          <span className="settings-service-model" title={provider.model}>{provider.model}</span>
        </span>
      </button>
      <div className="settings-service-row-end">
        {!hasProviderCredentials(provider) && <span className="settings-service-status text-destructive" data-testid="service-status">{i18n.t("options.service.keyMissing")}</span>}
        <button type="button" className="settings-service-icon-button" disabled={busy} onClick={onEdit} aria-label={i18n.t("options.service.editTitle", [provider.name])} title={i18n.t("options.service.edit")}><IconPencil aria-hidden="true" /></button>
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
          <summary aria-label={i18n.t("options.service.actions", [provider.name])}><IconDots aria-hidden="true" /></summary>
          <div className="settings-service-menu-panel">
            <button type="button" disabled={busy || !ready} onClick={() => void act("test")}>
              <IconBolt aria-hidden="true" />
              {i18n.t("options.service.test")}
            </button>
            <button type="button" className="text-destructive" disabled={busy || active} title={active ? i18n.t("options.service.removeCurrentHint") : undefined} onClick={() => void act("remove")}>
              <IconTrash aria-hidden="true" />
              {i18n.t("options.service.remove")}
            </button>
          </div>
        </details>
      </div>
    </article>
  )
}

function ServiceEditor({ current, makeCurrent, onMakeCurrentChange, onBusyChange, onDone, onCancel }: { current: ProviderConfig | undefined, makeCurrent: boolean, onMakeCurrentChange?: (value: boolean) => void, onBusyChange: (value: boolean) => void, onDone: () => void, onCancel: () => void }) {
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
        style={{ height: `${Math.max(235, Math.min(rows * 18 + 24, 400))}px` }}
        onChange={(event) => {
          setText(event.target.value)
          setFailure(null)
        }}
        className="settings-service-document w-full resize-y rounded-lg border border-input bg-card px-3 py-[11px] font-mono text-xs leading-[18px] outline-none selection:bg-link/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-60"
      />
      {parsed && !parsed.ok && <p role="alert" className="settings-service-form-error">{parsed.error}</p>}
      {preview?.keyStatus === "missing" && <p role="alert" className="settings-service-form-error">{i18n.t("options.service.keyMissing")}</p>}
      {!current && <UseAfterAdd value={makeCurrent} onChange={onMakeCurrentChange} disabled={applying} />}
      {failure !== null && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 text-xs">
          <p className="font-medium text-destructive">{i18n.t(current ? "options.service.failedNotSaved" : "options.service.failedAdd")}</p>
          {failure && <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-xs leading-[17px] text-muted-foreground">{failure}</code>}
          {!current && <p className="mt-1 text-muted-foreground">{i18n.t("options.service.draftKept")}</p>}
        </div>
      )}
      <div className="settings-service-form-actions">
        <Button variant="outline" className="px-3.5 text-[13px] font-normal" disabled={applying} onClick={onCancel}>
          {i18n.t("options.service.cancel")}
        </Button>
        <Button className="px-4 text-[13px] font-semibold" disabled={!canApply} onClick={() => void apply()}>
          {applying ? i18n.t("options.service.applying") : i18n.t(current ? "options.service.checkSave" : "options.service.checkAdd")}
        </Button>
      </div>
    </>
  )
}
