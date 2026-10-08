import type { ProviderType } from "@/types/config/provider"
import { IconSpark } from "@/components/icons"
import { PROVIDER_ITEMS } from "@/utils/constants/providers"

/** Local provider marks for the settings list and editor; no remote logos. */
export function ServiceMark({ provider }: { provider: ProviderType }) {
  return (
    <span className="settings-service-mark" data-provider={provider} aria-hidden="true">
      {provider === "gemini" ? <IconSpark /> : PROVIDER_ITEMS[provider].monogram}
    </span>
  )
}
