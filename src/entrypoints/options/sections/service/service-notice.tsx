import { AnimatePresence } from "motion/react"
import { useCallback } from "react"
import { i18n } from "#imports"
import { CornerFade } from "@/components/corner-fade"
import { IconAlertCircle, IconCheck, IconLoader, IconX } from "@/components/icons"
import { useFeedbackDismiss } from "@/components/use-feedback-dismiss"

export interface ServiceFeedback {
  id: number
  kind: "success" | "error" | "testing"
  message: string
  description?: string
  retry?: () => void
}

export type NotifyService = (feedback: Omit<ServiceFeedback, "id">) => void

function Notice({ feedback, onDismiss }: { feedback: ServiceFeedback, onDismiss: () => void }) {
  const interaction = useFeedbackDismiss(4000, onDismiss, feedback.kind !== "success")
  const Icon = feedback.kind === "testing" ? IconLoader : feedback.kind === "error" ? IconAlertCircle : IconCheck
  return (
    <CornerFade className="settings-service-notice" data-kind={feedback.kind} role={feedback.kind === "error" ? "alert" : "status"} {...interaction}>
      <Icon className="settings-service-notice-icon" aria-hidden="true" />
      <div className="settings-service-notice-copy">
        <p>{feedback.message}</p>
        {feedback.description && <p className="settings-service-notice-description">{feedback.description}</p>}
        {feedback.retry && <button type="button" className="settings-service-retry" onClick={feedback.retry}>{i18n.t("options.service.retryTest")}</button>}
      </div>
      <button type="button" className="settings-service-icon-button" aria-label={i18n.t("siteRuleAgent.close")} onClick={onDismiss}><IconX aria-hidden="true" /></button>
    </CornerFade>
  )
}

export function ServiceNotice({ feedback, onDismiss }: { feedback: ServiceFeedback | null, onDismiss: () => void }) {
  const dismiss = useCallback(onDismiss, [onDismiss])
  return <AnimatePresence>{feedback && <Notice key={feedback.id} feedback={feedback} onDismiss={dismiss} />}</AnimatePresence>
}
