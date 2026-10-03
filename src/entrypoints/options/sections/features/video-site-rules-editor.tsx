import type { VideoSiteRule } from "@/types/config/video-site-rules"
import { useAtom } from "jotai"
import { useId, useState } from "react"
import { i18n } from "#imports"
import { Button } from "@/components/ui/button"
import { VIDEO_SITE_RULE_TYPES } from "@/types/config/video-site-rules"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { normalizeVideoSiteRule } from "@/utils/subtitles/video-site-rules"
import { SettingsSelect } from "../../components/settings-select"

const PLACEHOLDERS: Record<VideoSiteRule["type"], string> = {
  domain: "example.com",
  pattern: "*.example.com/watch/*",
  regex: "^https://example\\.com/",
}

export function VideoSiteRulesEditor() {
  const [features, setFeatures] = useAtom(configFieldsAtomMap.features)
  const rules = features.videoExcludedSites
  const [type, setType] = useState<VideoSiteRule["type"]>("domain")
  const [value, setValue] = useState("")
  const [error, setError] = useState<"invalid" | "duplicate" | "saveFailed" | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()
  const titleId = `${inputId}-title`
  const helpId = `${inputId}-help`
  const errorId = `${inputId}-error`
  const inputInvalid = error === "invalid" || error === "duplicate"

  const save = async (next: VideoSiteRule[], clearInput: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await setFeatures({ videoExcludedSites: next })
      if (clearInput)
        setValue("")
    }
    catch {
      setError("saveFailed")
    }
    finally {
      setBusy(false)
    }
  }

  const add = () => {
    if (busy)
      return
    const rule = normalizeVideoSiteRule({ type, value })
    if (!rule) {
      setError("invalid")
      return
    }
    if (rules.some((existing) => {
      const normalized = normalizeVideoSiteRule(existing)
      return normalized?.type === rule.type && normalized.value === rule.value
    })) {
      setError("duplicate")
      return
    }
    void save([...rules, rule], true)
  }

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="settings-group-caption">{i18n.t("videoSiteRules.title")}</h2>
        {!busy && !error && rules.length > 0 && <span className="text-[11px] text-[#4f6e54] dark:text-[#91b796]">{i18n.t("videoSiteRules.saved")}</span>}
      </div>
      <div className="settings-group px-[23px] py-5 max-sm:px-[18px]">
        <p className="mb-[19px] text-xs leading-relaxed text-muted-foreground">{i18n.t("videoSiteRules.description")}</p>
        {error === "saveFailed" && (
          <p id={errorId} role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[11px] leading-relaxed text-destructive">
            {i18n.t("videoSiteRules.saveFailed")}
          </p>
        )}
        <form
          className="flex min-w-0 flex-col gap-2.5"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <SettingsSelect
            aria-label={i18n.t("videoSiteRules.ruleType")}
            className="w-full sm:w-[205px]"
            value={type}
            disabled={busy}
            options={VIDEO_SITE_RULE_TYPES.map(value => ({ value, label: i18n.t(`videoSiteRules.types.${value}`) }))}
            onValueChange={(value) => {
              setType(value as VideoSiteRule["type"])
              setError(null)
            }}
          />
          <label htmlFor={inputId} className="text-xs">{i18n.t("videoSiteRules.ruleLabel")}</label>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <input
              id={inputId}
              disabled={busy}
              value={value}
              placeholder={PLACEHOLDERS[type]}
              aria-invalid={inputInvalid || undefined}
              aria-describedby={inputInvalid ? `${helpId} ${errorId}` : helpId}
              autoComplete="off"
              spellCheck={false}
              className="min-w-[170px] flex-1 rounded-lg border border-input bg-card px-3 py-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/10"
              onChange={(event) => {
                setValue(event.target.value)
                setError(null)
              }}
            />
            <Button type="submit" disabled={busy} className="h-9 rounded-lg px-3 text-xs">{i18n.t("videoSiteRules.add")}</Button>
          </div>
          <p id={helpId} className="text-[11px] leading-relaxed text-muted-foreground">{i18n.t(`videoSiteRules.hints.${type}`)}</p>
          {inputInvalid && <p id={errorId} role="alert" className="text-[11px] leading-relaxed text-destructive">{i18n.t(`videoSiteRules.${error}`)}</p>}
        </form>
        {rules.length > 0 && (
          <ul className="mt-[18px] list-none border-t border-border">
            {rules.map((rule, index) => (
              <li key={`${rule.type}:${rule.value}`} className="flex items-center gap-[11px] border-b border-border py-[13px] last:border-b-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <span className="block font-mono text-xs break-all">{rule.type === "pattern" ? rule.value.replace(/^\*:\/\//, "") : rule.value}</span>
                  <span className="mt-1.5 block text-[10px] text-muted-foreground">{i18n.t(`videoSiteRules.types.${rule.type}`)}</span>
                </div>
                <button
                  type="button"
                  aria-label={i18n.t("videoSiteRules.remove")}
                  disabled={busy}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  onClick={() => void save(rules.filter((_, current) => current !== index), false)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-[15px]"><path d="m6 6 12 12M6 18 18 6" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
