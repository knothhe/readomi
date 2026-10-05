import type { Config } from "@/types/config/config"
import { useSetAtom, useStore } from "jotai"
import { useRef, useState } from "react"
import { i18n } from "#imports"
import { IconAlertCircle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { configAtom, replaceConfigAtom } from "@/utils/atoms/config"
import { exportConfigBackup, MAX_BACKUP_SIZE, parseConfigBackup } from "@/utils/config/backup"
import { EXTENSION_VERSION } from "@/utils/constants/app"
import { sendMessage } from "@/utils/message"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"

export function BackupSection() {
  const store = useStore()
  const replace = useSetAtom(replaceConfigAtom)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string, config: Config } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
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
  const requestVersionRef = useRef(0)
  const download = () => {
    const blob = new Blob([exportConfigBackup(store.get(configAtom))], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `readomi-config-v${EXTENSION_VERSION}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const load = async (file?: File) => {
    const version = ++requestVersionRef.current
    setPending(null)
    setError(null)
    setSaved(false)
    if (!file)
      return
    try {
      if (file.size > MAX_BACKUP_SIZE)
        throw new Error("Configuration file exceeds 1 MB")
      const config = parseConfigBackup(await file.text())
      if (version === requestVersionRef.current)
        setPending({ name: file.name, config })
    }
    catch (error) {
      if (version === requestVersionRef.current)
        setError(error instanceof Error ? error.message : String(error))
    }
  }
  const apply = async () => {
    if (!pending)
      return
    setBusy(true)
    setError(null)
    try {
      await replace(pending.config)
      setPending(null)
      setSaved(true)
    }
    catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
    finally {
      setBusy(false)
    }
  }
  const provider = pending?.config.providersConfig.find(p => p.id === pending.config.translate.providerId)
  return (
    <SettingsSection id="backup" title={i18n.t("configBackup.title")}>
      <div className="settings-backup-content flex flex-col gap-5">
        <SettingsGroup>
          <SettingsRow
            label={i18n.t("configBackup.export")}
            description={i18n.t("configBackup.exportDescription")}
            control={(
              <Button variant="outline" size="sm" disabled={busy} onClick={download}>
                {i18n.t("configBackup.exportAction")}
              </Button>
            )}
          />
          <SettingsRow
            label={i18n.t("configBackup.import")}
            description={i18n.t("configBackup.importDescription")}
            control={(
              <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
                {i18n.t("configBackup.importAction")}
              </Button>
            )}
          />
        </SettingsGroup>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label={i18n.t("configBackup.import")}
          onChange={(e) => {
            void load(e.target.files?.[0])
            e.target.value = ""
          }}
        />
        <div className="flex max-w-[720px] items-start gap-2 text-[11px] leading-[1.7] text-muted-foreground">
          <IconAlertCircle className="mt-0.5 size-4 shrink-0" stroke={1.6} aria-hidden="true" />
          <p>{i18n.t("configBackup.description")}</p>
        </div>
        {pending && (
          <div className="flex flex-col gap-4 rounded-[10px] border border-border bg-card p-5">
            <p className="break-all text-sm font-medium">{i18n.t("configBackup.preview", [pending.name])}</p>
            <p className="rounded-lg border border-border bg-background p-4 font-mono text-xs leading-[1.7]">{i18n.t("configBackup.service", [provider?.name ?? "—", provider?.model ?? "—"])}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>{i18n.t("configBackup.cancel")}</Button>
              <Button disabled={busy} onClick={() => void apply()}>{i18n.t("configBackup.apply")}</Button>
            </div>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-xs font-medium text-destructive">{i18n.t("configBackup.failed")}</p>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted-foreground">{error}</pre>
          </div>
        )}
        {saved && <p role="status" className="text-xs text-success">{i18n.t("configBackup.saved")}</p>}
        <SettingsGroup caption={i18n.t("cacheManagement.title")}>
          <SettingsRow
            label={i18n.t("cacheManagement.clearAll")}
            description={i18n.t("cacheManagement.description")}
            control={<Button variant="outline" size="sm" disabled={cacheState === "pending"} onClick={() => void clearCache()}>{i18n.t(cacheState === "pending" ? "cacheManagement.pending" : "cacheManagement.clear")}</Button>}
          />
          {(cacheState === "failed" || cacheState === "success") && <p role={cacheState === "failed" ? "alert" : "status"} className="text-xs text-muted-foreground">{i18n.t(cacheState === "failed" ? "cacheManagement.failed" : "cacheManagement.success")}</p>}
        </SettingsGroup>
      </div>
    </SettingsSection>
  )
}
