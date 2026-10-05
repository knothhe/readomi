import { i18n } from "#imports"
import { describeTranslationError } from "@/utils/error/translation-error"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"
import { RetryButton } from "./retry-button"

function describeError(error: Error): string {
  if (error.name === "TranslationQualityError")
    return i18n.t("translation.invalidResult")

  const { statusCode } = getRequestErrorMeta(error)
  const status = statusCode ? `${statusCode} ` : ""
  const message = error.message?.trim() || i18n.t("translation.unknownError")
  return `${status}${message}`
}

/**
 * Inline replacement for a paragraph whose translation failed: one muted
 * line with the reason and a retry button, nothing floating.
 */
export function TranslationError({ nodes, error }: { nodes: ChildNode[], error: Error }) {
  const detail = describeError(error)

  return (
    <div className="notranslate inline-flex max-w-full flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>
        {i18n.t("translation.failed")}
        {" · "}
        {describeTranslationError(error)}
      </span>
      <RetryButton nodes={nodes} />
      <details className="max-w-full text-xs">
        <summary className="cursor-pointer">{i18n.t("errorRecovery.errorDetails")}</summary>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{detail}</pre>
      </details>
    </div>
  )
}
