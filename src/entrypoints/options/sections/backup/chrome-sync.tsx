import type { BrowserEnvironment } from "@/utils/browser-environment"
import type { ConfigSyncStatus } from "@/utils/config/sync-state"
import { useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { i18n, storage } from "#imports"
import { IconAlertCircle, IconCheck } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { configAtom } from "@/utils/atoms/config"
import { detectBrowserEnvironment } from "@/utils/browser-environment"
import { DEFAULT_SYNC_STATUS, SYNC_STATE_KEY, syncStatusSchema } from "@/utils/config/sync-state"
import { sendMessage } from "@/utils/message"
import { hasProviderCredentials } from "@/utils/service-management"
import { SettingsGroup, SettingsRow } from "../../components/settings-section"
import { BackupDialog } from "./dialog"

export function ChromeSync({ onStatusChange }: { onStatusChange: (status: ConfigSyncStatus) => void }) {
  const config = useAtomValue(configAtom)
  const [environment, setEnvironment] = useState<BrowserEnvironment>({ name: "", supported: false })
  const [status, setStatus] = useState(DEFAULT_SYNC_STATUS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<{ revision: string } | null>(null)
  const [source, setSource] = useState<"remote" | "local">("remote")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let supportedHere = false
    const update = (next: ConfigSyncStatus) => {
      if (!stopped && supportedHere) {
        setStatus(next)
        onStatusChange(next)
      }
    }
    const unwatch = storage.watch<unknown>(SYNC_STATE_KEY, (value) => {
      const parsed = syncStatusSchema.safeParse(value)
      if (parsed.success)
        update(parsed.data)
    })
    void detectBrowserEnvironment().then(async (detected) => {
      if (stopped)
        return
      supportedHere = detected.supported
      setEnvironment(detected)
      if (detected.supported) {
        const info = await sendMessage("getConfigSyncInfo")
        if (!stopped && info) {
          supportedHere = info.environment.supported
          setEnvironment(info.environment)
          update(info.status)
        }
      }
    }).catch(() => {
      if (!stopped)
        setError(i18n.t("configSync.actionFailed"))
    }).finally(() => {
      if (!stopped)
        setLoading(false)
    })
    return () => {
      stopped = true
      unwatch()
    }
  }, [onStatusChange])

  const enable = async (selected: "local" | "remote", revision: string | null) => {
    const info = await sendMessage("setConfigSyncEnabled", { enabled: true, source: selected, revision })
    setStatus(info.status)
    onStatusChange(info.status)
    setChoice(null)
  }
  const act = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    }
    catch (cause) {
      setError(i18n.t(cause instanceof Error && cause.message === "Configuration sync changed" ? "configSync.choiceChanged" : "configSync.actionFailed"))
    }
    finally { setBusy(false) }
  }
  const toggle = (enabled: boolean) => void act(async () => {
    if (!enabled) {
      const info = await sendMessage("setConfigSyncEnabled", { enabled: false })
      setStatus(info.status)
      onStatusChange(info.status)
      return
    }
    const { revision } = await sendMessage("inspectConfigSync")
    if (revision) {
      setSource("remote")
      setChoice({ revision })
    }
    else { await enable("local", null) }
  })
  const supported = !loading && environment.supported
  const enabled = supported && status.enabled
  const problem = status.phase === "failed" || status.phase === "quota"
  const missing = config.providersConfig.filter(p => p.enabled && p.model.trim() && !hasProviderCredentials(p) && !Object.keys(p.headers ?? {}).length)
  const statusText = status.phase === "quota" ? "configSync.quota" : status.phase === "failed" ? "configSync.failed" : status.phase === "pending" ? "configSync.pending" : "configSync.saved"

  return (
    <div className="flex flex-col">
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <h2 className="settings-group-caption">{i18n.t("configSync.title")}</h2>
        <span className="text-right text-[11px] text-muted-foreground">{i18n.t("configSync.browser", [loading ? i18n.t("configSync.detecting") : environment.name || i18n.t("configSync.otherBrowser")])}</span>
      </div>
      <SettingsGroup>
        <SettingsRow
          label={i18n.t("configSync.toggle")}
          description={i18n.t(supported || loading ? "configSync.toggleDescription" : "configSync.unsupported")}
          className={!supported && !loading ? "text-muted-foreground" : undefined}
          control={<Switch checked={enabled} disabled={!supported || busy} onCheckedChange={toggle} aria-label={i18n.t("configSync.toggle")} />}
        />
        {enabled && (
          <SettingsRow
            label={(
              <span className={`flex items-center gap-2 ${problem ? "text-[#946126] dark:text-[#d6b581]" : status.phase === "pending" ? "text-muted-foreground" : "text-success"}`}>
                {problem ? <IconAlertCircle className="size-4" /> : status.phase === "saved" ? <IconCheck className="size-4" /> : <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border border-current border-t-transparent motion-reduce:animate-none" />}
                <span role="status">{i18n.t(statusText)}</span>
              </span>
            )}
            description={problem
              ? (
                  <>
                    {i18n.t("configSync.failureDescription")}
                    <br />
                    {i18n.t(status.phase === "quota" ? "configSync.quotaHint" : "configSync.retryHint")}
                  </>
                )
              : status.phase === "pending" ? i18n.t("configSync.localSaved") : status.savedAt ? i18n.t("configSync.lastSaved", [new Date(status.savedAt).toLocaleString()]) : undefined}
            control={problem && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void act(async () => {
                  const info = await sendMessage("retryConfigSync")
                  setStatus(info.status)
                  onStatusChange(info.status)
                })}
              >
                {i18n.t("configSync.retry")}
              </Button>
            )}
          />
        )}
        <div className="flex flex-col gap-2 bg-background/50 px-[18px] py-[15px] text-xs leading-[1.7] text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{i18n.t("configSync.scope")}</span>
            <br />
            {i18n.t("configSync.scopeDescription")}
          </p>
          <p>
            <span className="font-medium text-foreground">{i18n.t("configSync.localOnly")}</span>
            <br />
            {i18n.t("configSync.localOnlyDescription")}
          </p>
        </div>
      </SettingsGroup>
      {supported && (
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-[1.7] text-muted-foreground">
          <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{i18n.t("configSync.requirement")}</span>
        </p>
      )}
      {enabled && missing.length > 0 && (
        <div className="mt-3 flex gap-2.5 rounded-lg border border-[#ddcdb7] bg-[#f8f0e3] dark:border-[#584935] dark:bg-[#342d22] p-4">
          <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-[#946126] dark:text-[#d6b581]" />
          <div>
            <p className="text-[13px] font-medium">{i18n.t("configSync.needsKeys")}</p>
            <p className="mt-1 text-xs leading-[1.65] text-muted-foreground">{i18n.t("configSync.needsKeysDescription", [missing.map(p => p.name).join("、")])}</p>
            <a className="mt-2 inline-block text-xs text-primary" href="#service">{i18n.t("configSync.openServices")}</a>
          </div>
        </div>
      )}
      {error && !choice && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      {choice && (
        <BackupDialog
          title={i18n.t("configSync.chooseTitle")}
          busy={busy}
          onClose={() => {
            setChoice(null)
            setError(null)
          }}
        >
          <p className="mt-2.5 text-xs text-muted-foreground">{i18n.t("configSync.chooseDescription")}</p>
          <div className="my-5 flex flex-col gap-2.5">
            {(["remote", "local"] as const).map(value => (
              <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-[15px] ${source === value ? "border-primary bg-primary/10" : "border-border"}`}>
                <input type="radio" name="sync-source" value={value} checked={source === value} disabled={busy} onChange={() => setSource(value)} className="mt-0.5 accent-primary" />
                <span className="text-[13px] font-medium">
                  {i18n.t(value === "remote" ? "configSync.useRemote" : "configSync.useLocal")}
                  {value === "remote" && <span className="ml-2 text-[10px] font-normal text-primary">{i18n.t("configSync.recommended")}</span>}
                </span>
              </label>
            ))}
          </div>
          <p className="flex items-start gap-2 text-[11px] leading-[1.7] text-muted-foreground">
            <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{i18n.t("configSync.chooseHint")}</span>
          </p>
          {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setChoice(null)
                setError(null)
              }}
            >
              {i18n.t("configBackup.cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void act(() => enable(source, choice.revision))}>{i18n.t("configSync.enable")}</Button>
          </div>
        </BackupDialog>
      )}
    </div>
  )
}
