import { useRef, useState } from "react"
import { i18n } from "#imports"
import { Button } from "@/components/ui/button"
import { sendMessage } from "@/utils/message"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"

export function CacheSection() {
  const [cacheState, setCacheState] = useState<"idle" | "pending" | "success" | "failed">("idle")
  const cachePendingRef = useRef(false)
  const clearCache = async () => {
    if (cachePendingRef.current)
      return
    cachePendingRef.current = true
    setCacheState("pending")
    try {
      await sendMessage("clearTranslationCache")
      setCacheState("success")
    }
    catch {
      setCacheState("failed")
    }
    finally {
      cachePendingRef.current = false
    }
  }
  return (
    <SettingsSection id="cache" title={i18n.t("cacheManagement.title")}>
      <SettingsGroup>
        <SettingsRow
          label={i18n.t("cacheManagement.clearAll")}
          description={i18n.t("cacheManagement.description")}
          control={<Button variant="outline" size="sm" disabled={cacheState === "pending"} onClick={() => void clearCache()}>{i18n.t(cacheState === "pending" ? "cacheManagement.pending" : "cacheManagement.clear")}</Button>}
        />
        {(cacheState === "failed" || cacheState === "success") && <p role={cacheState === "failed" ? "alert" : "status"} className="px-[18px] py-3.5 text-xs text-muted-foreground">{i18n.t(cacheState === "failed" ? "cacheManagement.failed" : "cacheManagement.success")}</p>}
      </SettingsGroup>
    </SettingsSection>
  )
}
