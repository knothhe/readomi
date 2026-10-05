import { i18n } from "#imports"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"

export function describeTranslationError(error: Error): string {
  const { statusCode, kind } = getRequestErrorMeta(error)
  if (error.name === "TranslationQualityError" || error.name === "TranslationProtocolError")
    return i18n.t("translation.errorReasons.quality")
  if (statusCode === 401 || statusCode === 403)
    return i18n.t("translation.errorReasons.key")
  if (statusCode === 429 || kind === "rate-limit")
    return i18n.t("translation.errorReasons.rate")
  if (kind === "timeout" || error.name === "TimeoutError" || error.name === "AbortError")
    return i18n.t("translation.errorReasons.timeout")
  if (kind === "network")
    return i18n.t("translation.errorReasons.network")
  if (statusCode && statusCode >= 500)
    return i18n.t("translation.errorReasons.service")
  return i18n.t("translation.errorReasons.unknown")
}
