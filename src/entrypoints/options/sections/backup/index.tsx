import type { Config } from "@/types/config/config"
import { useSetAtom, useStore } from "jotai"
import { useRef, useState } from "react"
import { i18n } from "#imports"
import { Button } from "@/components/ui/button"
import { configAtom, replaceConfigAtom } from "@/utils/atoms/config"
import { exportConfigBackup, MAX_BACKUP_SIZE, parseConfigBackup } from "@/utils/config/backup"
import { clearConfigResetNotice } from "@/utils/config/storage"
import { logger } from "@/utils/logger"
import { SettingsSection } from "../../components/settings-section"

export function BackupSection() {
  const store = useStore()
  const replace = useSetAtom(replaceConfigAtom)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string, config: Config } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestVersionRef = useRef(0)
  const download = () => {
    const blob = new Blob([exportConfigBackup(store.get(configAtom))], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "reading-config.json"
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
      await clearConfigResetNotice().catch(error => logger.error("Could not clear configuration reset notice", error))
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
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-[18px]">
        <p className="text-xs text-muted-foreground">{i18n.t("configBackup.description")}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={download}>{i18n.t("configBackup.export")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>{i18n.t("configBackup.import")}</Button>
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
        </div>
        {pending && (
          <div className="flex flex-col gap-2">
            <p>{i18n.t("configBackup.preview", [pending.name])}</p>
            <p>{i18n.t("configBackup.service", [provider?.name ?? "—", provider?.model ?? "—"])}</p>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void apply()}>{i18n.t("configBackup.apply")}</Button>
              <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>{i18n.t("configBackup.cancel")}</Button>
            </div>
          </div>
        )}
        {error && (
          <div role="alert">
            <p className="text-destructive">{i18n.t("configBackup.failed")}</p>
            <pre className="whitespace-pre-wrap break-all text-xs">{error}</pre>
          </div>
        )}
        {saved && <p role="status">{i18n.t("configBackup.saved")}</p>}
      </div>
    </SettingsSection>
  )
}
