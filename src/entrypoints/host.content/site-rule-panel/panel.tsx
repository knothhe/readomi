import type { SiteRuleSessionResult } from "@/utils/site-rules/document"
import type { SiteRulePreviewController, SiteRulePreviewReport } from "@/utils/site-rules/preview-controller"
import { AnimatePresence } from "motion/react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { i18n } from "#imports"
import { BrandIcon } from "@/components/brand-icon"
import { copyText } from "@/utils/clipboard"
import { getLocalConfig } from "@/utils/config/storage"
import { onMessage, sendMessage } from "@/utils/message"
import { buildSiteRuleAgentInstructions } from "@/utils/site-rules/document"
import { getUILanguagePreference, subscribeUILanguage } from "@/utils/ui-language"
import { SiteRuleSavedNotice } from "./saved-notice"

type View = "hidden" | "expanded" | "folded" | "saved"
type Busy = "preview" | "save" | "stop" | "undo" | "reload" | null

export function SiteRulePanel({ controller }: { controller: SiteRulePreviewController }) {
  const [report, setReport] = useState<SiteRulePreviewReport>(() => controller.getReport())
  const [view, setView] = useState<View>("hidden")
  const [text, setText] = useState(report.session?.text ?? "")
  const [problem, setProblem] = useState("")
  const [moreOpen, setMoreOpen] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<"saveFailed" | "previewFailed" | "undoConflict" | "operationFailed" | null>(null)
  const [issues, setIssues] = useState<Array<{ code: string, path: string, message: string }>>([])
  const [copyStatus, setCopyStatus] = useState<"copied" | "copyFailed" | null>(null)
  const [fallbackText, setFallbackText] = useState("")
  const [notice, setNotice] = useState<"undone" | null>(null)
  const [saveCount, setSaveCount] = useState(0)
  const currentTextRef = useRef(text)
  const previousSessionTextRef = useRef(text)
  const aliveRef = useRef(true)
  const operationRef = useRef(false)
  useSyncExternalStore(subscribeUILanguage, getUILanguagePreference)

  useEffect(() => {
    aliveRef.current = true
    const unsubscribe = controller.subscribe((next) => {
      setReport(next)
      const nextText = next.session?.text ?? ""
      if (nextText !== previousSessionTextRef.current) {
        // Keep unsent local edits while a stop/refresh reply arrives.
        if (currentTextRef.current === previousSessionTextRef.current) {
          currentTextRef.current = nextText
          setText(nextText)
        }
        previousSessionTextRef.current = nextText
      }
      if (next.session?.status === "previewing")
        setView(value => value === "hidden" ? "folded" : value)
    })
    const unlisten = onMessage("openSiteRulePanel", () => {
      setView(window.matchMedia("(max-width: 600px)").matches ? "folded" : "expanded")
      void controller.reload()
    })
    return () => {
      aliveRef.current = false
      unsubscribe()
      unlisten()
    }
  }, [controller])

  const session = report.session
  const dirty = text.trim() !== (session?.text ?? "").trim()
  const previewing = report.status === "previewing" && !dirty
  const readyToSave = previewing && session?.previewRevision === session?.revision
    && session?.previewAcknowledged === true && report.diagnostics.readableBodyCount > 0 && !busy
  const hasCandidate = !!text.trim()
  const host = session?.siteHosts[0] ?? new URL(report.currentUrl).hostname
  const pending = busy !== null || report.status === "restoring"
  const changed = session?.document?.changes ?? []
  const upserts = changed.filter(item => item.action === "upsert").length
  const disables = changed.length - upserts
  const allIssues = issues.length ? issues : report.diagnostics.issues
  const conflict = session?.status === "conflict"
  const invalid = report.status === "invalid"
  const statusLabel = error || (conflict
    ? "conflict"
    : report.status === "paused"
      ? "paused"
      : report.status === "restoring"
        ? "restoring"
        : invalid
          ? "invalid"
          : previewing
            ? report.diagnostics.readableBodyCount === 0 ? "noContent" : "previewing"
            : report.status === "error"
              ? report.diagnostics.readableBodyCount === 0 ? "noContent" : "previewFailed"
              : hasCandidate ? "candidate" : null)

  const syncInput = (value: string) => {
    currentTextRef.current = value
    setText(value)
  }

  const run = async (kind: NonNullable<Busy>, action: () => Promise<SiteRuleSessionResult>, sync = false) => {
    if (operationRef.current)
      return
    operationRef.current = true
    setBusy(kind)
    setError(null)
    setIssues([])
    setNotice(null)
    try {
      const result = await action()
      if (!aliveRef.current)
        return
      if (!result.ok) {
        setIssues(result.issues)
        setError(result.issues.some(issue => issue.code === "conflict") && kind !== "undo" ? null : kind === "save" ? "saveFailed" : kind === "undo" ? "undoConflict" : "previewFailed")
        if (kind === "undo")
          setView("expanded")
      }
      else {
        if (sync && result.session)
          syncInput(result.session.text)
        if (kind === "save") {
          setSaveCount(value => value + 1)
          setView("saved")
          setMoreOpen(false)
        }
        if (kind === "undo") {
          setView(view === "saved" ? "saved" : "expanded")
          setCopyStatus(null)
          setNotice("undone")
        }
      }
      await controller.reload()
    }
    catch {
      if (aliveRef.current) {
        setError(kind === "save" ? "saveFailed" : kind === "undo" ? "undoConflict" : "operationFailed")
        if (kind === "undo")
          setView("expanded")
      }
    }
    finally {
      operationRef.current = false
      if (aliveRef.current)
        setBusy(null)
    }
  }

  const preview = () => run("preview", async () => {
    const draft = await sendMessage("setSiteRuleDraft", { text: currentTextRef.current })
    if (!draft.ok || !draft.session)
      return draft
    return sendMessage("previewSiteRuleDraft", { revision: draft.session.revision })
  }, true)

  const stop = () => run("stop", () => sendMessage("stopSiteRulePreview", undefined))

  const changeText = (value: string) => {
    syncInput(value)
    setError(null)
    setIssues([])
    setNotice(null)
    // Editing immediately retires the applied draft. It cannot be saved again
    // until the edited document has gone through the same preview pipeline.
    if (session?.status === "previewing" && !operationRef.current)
      void stop()
  }

  const copy = async (value: string) => {
    const success = await copyText(value)
    if (aliveRef.current) {
      setCopyStatus(success ? "copied" : "copyFailed")
      setFallbackText(success ? "" : value)
    }
  }

  const copyInstructions = async () => {
    try {
      const config = await getLocalConfig()
      if (!config)
        throw new Error("Configuration unavailable")
      await copy(buildSiteRuleAgentInstructions(config, report.currentUrl, problem.trim() || undefined))
    }
    catch {
      setError("operationFailed")
    }
  }

  const reportText = JSON.stringify({ protocolVersion: 1, status: report.status, currentUrl: report.currentUrl, revision: session?.revision, draftHash: session?.draftHash, previewRevision: session?.previewRevision, previewHash: session?.previewHash, hasLocalEdits: dirty, diagnostics: report.diagnostics, observations: report.observations }, null, 2)
  const issueMessage = (issue: { code: string, message: string }) => {
    if (issue.code === "click_hold_unsupported")
      return i18n.t("siteRuleAgent.hoverTriggerHelp")
    if (issue.code === "no_matched_body")
      return i18n.t("siteRuleAgent.noContent")
    if (issue.code === "scope_mismatch")
      return i18n.t("siteRuleAgent.scopeHelp")
    if (issue.code === "preview_failed")
      return i18n.t("siteRuleAgent.previewFailed")
    if (issue.code === "request_failed")
      return i18n.t("siteRuleAgent.requestFailed")
    return issue.message
  }
  const close = async () => {
    if (session?.status === "previewing" && view !== "saved")
      await stop()
    if (controller.getReport().session?.status === "previewing") {
      setView("folded")
      return
    }
    if (aliveRef.current)
      setView("hidden")
  }

  if (view === "hidden" || view === "saved") {
    return (
      <AnimatePresence>
        {view === "saved" && (
          <SiteRuleSavedNotice
            key={saveCount}
            pending={pending}
            undoAvailable={!!session?.undoAvailable}
            undone={notice === "undone"}
            error={error ? i18n.t(`siteRuleAgent.${error}`) : null}
            onUndo={() => void run("undo", () => sendMessage("undoSiteRuleSave", undefined))}
            onManage={() => {
              void sendMessage("openOptionsPage", { section: "reading/site-rules", siteRulesTab: "custom" }).catch(() => {
                if (aliveRef.current)
                  setError("operationFailed")
              })
            }}
            onDismiss={() => setView("hidden")}
          />
        )}
      </AnimatePresence>
    )
  }

  if (view === "folded") {
    return (
      <div className="site-rule-folded" data-testid="readomi-rule-session-panel">
        <button type="button" className="site-rule-expand" aria-label={i18n.t("siteRuleAgent.expand")} onClick={() => setView("expanded")}>
          <BrandIcon size={32} />
          <span>
            {i18n.t(previewing ? "siteRuleAgent.previewing" : "siteRuleAgent.title")}
            <small>{host}</small>
          </span>
        </button>
        {session?.status === "previewing" && <button type="button" className="site-rule-link" disabled={pending} onClick={() => void stop()}>{i18n.t("siteRuleAgent.stop")}</button>}
      </div>
    )
  }

  const editor = (
    <form onSubmit={(event) => {
      event.preventDefault()
      void preview()
    }}
    >
      <label className="site-rule-field" htmlFor="readomi-rule-document">{i18n.t("siteRuleAgent.document")}</label>
      <textarea
        id="readomi-rule-document"
        data-testid="readomi-rule-document-input"
        className="site-rule-code"
        value={text}
        placeholder={i18n.t("siteRuleAgent.documentPlaceholder")}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        disabled={busy === "preview" || busy === "save" || busy === "undo"}
        onChange={event => changeText(event.target.value)}
      />
      <button type="submit" className="site-rule-button" data-testid="readomi-rule-preview-action" disabled={pending || !hasCandidate}>
        {i18n.t(busy === "preview" ? "siteRuleAgent.starting" : previewing ? "siteRuleAgent.repreview" : "siteRuleAgent.preview")}
      </button>
    </form>
  )

  return (
    <section className="site-rule-panel" data-testid="readomi-rule-session-panel" aria-label={i18n.t("siteRuleAgent.title")}>
      <header className="site-rule-header">
        <BrandIcon size={32} />
        <div>
          <strong>{i18n.t("siteRuleAgent.title")}</strong>
          <small>{host}</small>
        </div>
        <button type="button" aria-label={i18n.t("siteRuleAgent.collapse")} onClick={() => setView("folded")}>⌄</button>
        <button type="button" disabled={pending} aria-label={i18n.t("siteRuleAgent.close")} onClick={() => void close()}>×</button>
      </header>
      <div className="site-rule-body">
        {notice && <p className="site-rule-status" role="status">{i18n.t(`siteRuleAgent.${notice}`)}</p>}
        {statusLabel && <p className={`site-rule-status${error || conflict || invalid || report.status === "error" ? " site-rule-error" : ""}`} role="status">{i18n.t(`siteRuleAgent.${statusLabel}`)}</p>}
        {report.status === "paused" && <p className="site-rule-hint">{i18n.t("siteRuleAgent.pausedHelp", [host])}</p>}
        {!hasCandidate && (
          <>
            <label className="site-rule-field" htmlFor="readomi-rule-problem">{i18n.t("siteRuleAgent.problem")}</label>
            <textarea id="readomi-rule-problem" data-testid="readomi-rule-problem-input" className="site-rule-problem" maxLength={2000} value={problem} placeholder={i18n.t("siteRuleAgent.problemPlaceholder")} onChange={event => setProblem(event.target.value)} />
            <button type="button" className="site-rule-button site-rule-primary" data-testid="readomi-rule-instructions-action" onClick={() => void copyInstructions()}>{i18n.t("siteRuleAgent.copyInstructions")}</button>
            <button type="button" className="site-rule-link" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen}>{i18n.t("siteRuleAgent.paste")}</button>
          </>
        )}
        {hasCandidate && !dirty && session?.document && <p className="site-rule-hint">{i18n.t("siteRuleAgent.summary", [upserts, disables])}</p>}
        {allIssues.length > 0 && (
          <ul className="site-rule-issues">
            {allIssues.slice(0, 4).map(issue => (
              <li key={`${issue.path}:${issue.code}:${issue.message}`}>
                <code>{issue.path}</code>
                {`: ${issueMessage(issue)}`}
              </li>
            ))}
          </ul>
        )}
        {(invalid || report.status === "error") && <button type="button" className="site-rule-link" onClick={() => setMoreOpen(true)}>{i18n.t("siteRuleAgent.modify")}</button>}
        {hasCandidate && (
          <div className="site-rule-actions">
            {previewing
              ? (
                  <button
                    type="button"
                    className="site-rule-button site-rule-primary"
                    data-testid="readomi-rule-save-action"
                    disabled={!readyToSave}
                    onClick={(event) => {
                      if (event.nativeEvent.isTrusted && session)
                        void run("save", () => sendMessage("saveSiteRuleDraft", { revision: session.revision }), true)
                    }}
                  >
                    {i18n.t(busy === "save" ? "siteRuleAgent.saving" : error === "saveFailed" ? "siteRuleAgent.retrySave" : "siteRuleAgent.save")}
                  </button>
                )
              : <button type="button" className="site-rule-button site-rule-primary" disabled={pending} onClick={() => void preview()}>{i18n.t(busy === "preview" ? "siteRuleAgent.starting" : "siteRuleAgent.preview")}</button>}
            <button type="button" className="site-rule-button" data-testid="readomi-rule-stop-action" disabled={pending} onClick={() => void stop()}>{i18n.t("siteRuleAgent.stop")}</button>
          </div>
        )}
        {(conflict || error === "undoConflict") && <button type="button" className="site-rule-link" onClick={() => void sendMessage("openOptionsPage", { section: "reading/site-rules" })}>{i18n.t("siteRuleAgent.manage")}</button>}
        <details className="site-rule-more" data-testid="readomi-rule-more" open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)}>
          <summary>{i18n.t("siteRuleAgent.more")}</summary>
          {editor}
          <div className="site-rule-extra-actions">
            <button type="button" className="site-rule-link" data-testid="readomi-rule-copy-action" disabled={!hasCandidate} onClick={() => void copy(text)}>{i18n.t("siteRuleAgent.copyDocument")}</button>
            <button type="button" className="site-rule-link" onClick={() => void copy(reportText)}>{i18n.t("siteRuleAgent.copyDiagnostics")}</button>
            <button
              type="button"
              className="site-rule-link"
              disabled={pending}
              onClick={() => void run("reload", async () => {
                await controller.reload()
                return sendMessage("getSiteRuleSession", undefined)
              })}
            >
              {i18n.t("siteRuleAgent.reload")}
            </button>
            {hasCandidate && <button type="button" className="site-rule-link" onClick={() => void copyInstructions()}>{i18n.t("siteRuleAgent.copyInstructions")}</button>}
            {session?.undoAvailable && <button type="button" className="site-rule-link" disabled={pending} onClick={() => void run("undo", () => sendMessage("undoSiteRuleSave", undefined))}>{i18n.t("siteRuleAgent.undo")}</button>}
          </div>
          <p className="site-rule-hint">{i18n.t("siteRuleAgent.contentCount", [report.diagnostics.readableBodyCount])}</p>
          <pre className="site-rule-report" data-testid="readomi-rule-report" aria-label={i18n.t("siteRuleAgent.diagnostics")}>{reportText}</pre>
        </details>
        <p className="site-rule-hint site-rule-temporary">{i18n.t("siteRuleAgent.temporary")}</p>
        {copyStatus && <p className="site-rule-copy-status" role="status">{i18n.t(`siteRuleAgent.${copyStatus}`)}</p>}
        {fallbackText && <textarea className="site-rule-code" readOnly value={fallbackText} aria-label={i18n.t("siteRuleAgent.copyFailed")} onFocus={event => event.target.select()} />}
      </div>
    </section>
  )
}
