import { browser, i18n } from "#imports"
import { CornerFade } from "@/components/corner-fade"
import { useFeedbackDismiss } from "@/components/use-feedback-dismiss"

export function SiteRuleSavedNotice({ pending, undoAvailable, undone = false, error, onUndo, onManage, onDismiss }: {
  pending: boolean
  undoAvailable: boolean
  undone?: boolean
  error: string | null
  onUndo: () => void
  onManage: () => void
  onDismiss: () => void
}) {
  const interaction = useFeedbackDismiss(undone ? 3000 : 8000, onDismiss, pending || !!error)

  return (
    <CornerFade
      className="site-rule-saved"
      role="status"
      aria-live="polite"
      {...interaction}
    >
      <div className="site-rule-saved-heading">
        <svg className="site-rule-saved-check" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
        <strong>{i18n.t(undone ? "siteRuleAgent.undone" : "siteRuleAgent.saved")}</strong>
        <button type="button" className="site-rule-saved-close" aria-label={i18n.t("siteRuleAgent.close")} onClick={onDismiss}>×</button>
      </div>
      {!undone && (
        <div className="site-rule-saved-actions">
          <button
            type="button"
            className="site-rule-saved-undo"
            disabled={pending || !undoAvailable}
            onClick={(event) => {
              // Undo replaces this control; release focus before it is removed.
              event.currentTarget.blur()
              onUndo()
            }}
          >
            {i18n.t("siteRuleAgent.undo")}
          </button>
          <a
            className="site-rule-saved-manage"
            href={browser.runtime.getURL("/options.html?siteRulesTab=custom#reading/site-rules")}
            aria-disabled={pending || undefined}
            tabIndex={pending ? -1 : undefined}
            onClick={(event) => {
              event.preventDefault()
              if (!pending)
                onManage()
            }}
          >
            <span>{i18n.t("siteRuleAgent.viewRules")}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </a>
        </div>
      )}
      {error && <p className="site-rule-error" role="alert">{error}</p>}
    </CornerFade>
  )
}
