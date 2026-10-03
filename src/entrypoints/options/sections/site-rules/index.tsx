import type { KeyboardEvent, MouseEvent } from "react"
import type { SiteRule } from "@/types/config/site-rules"
import { useAtom } from "jotai"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { i18n } from "#imports"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { MAX_SITE_RULES_JSON_LENGTH } from "@/types/config/site-rules"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { copyText } from "@/utils/clipboard"
import { normalizeDisabledBuiltInRuleIds } from "@/utils/site-rules/branding"
import { BUILT_IN_SITE_RULES } from "@/utils/site-rules/built-in"
import { validateUserRulesDocument } from "./validate-user-rules"
import "./style.css"

const PAGE_SIZE = 50
const EXAMPLE = JSON.stringify([{
  id: "example",
  matches: "example.com",
  excludeSelectors: ["header", "footer"],
  forceBlockStyleSelectors: [".article-summary"],
}], null, 2)
type RulesTab = "builtin" | "custom"
const TABS: RulesTab[] = ["builtin", "custom"]

function patternsFor(rule: SiteRule) {
  return [...new Set(typeof rule.matches === "string" ? [rule.matches] : rule.matches)]
}

function PatternBadge({ pattern, expanded = false }: { pattern: string, expanded?: boolean }) {
  return (
    <span className={`site-rule-badge${expanded ? " site-rule-badge-expanded" : ""}`} title={pattern}>
      {pattern === "*" ? i18n.t("siteRules.allSites") : pattern}
    </span>
  )
}

function RuleRow({ rule, enabled, pending, onToggle }: {
  rule: SiteRule
  enabled?: boolean
  pending?: boolean
  onToggle?: (enabled: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle")
  const detailsId = useId()
  const patterns = patternsFor(rule)
  const json = useMemo(() => JSON.stringify(rule, null, 2), [rule])
  useEffect(() => {
    if (copyStatus !== "copied")
      return
    const timer = setTimeout(setCopyStatus, 2500, "idle")
    return () => clearTimeout(timer)
  }, [copyStatus])

  const copy = async () => {
    try {
      setCopyStatus(await copyText(json) ? "copied" : "failed")
    }
    catch {
      setCopyStatus("failed")
    }
  }

  return (
    <div className="site-rule-row" data-rule-id={rule.id}>
      <div className="site-rule-summary">
        <button
          type="button"
          className="site-rule-summary-button"
          aria-label={`${i18n.t("siteRules.viewRule")}: ${rule.id}`}
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          onClick={() => setExpanded(value => !value)}
        >
          <span className="site-rule-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
          <span className="site-rule-labels">
            <code className="site-rule-name" title={rule.id}>{rule.id}</code>
            {rule.description && <span className="site-rule-description" title={rule.description}>{rule.description}</span>}
          </span>
          <span className="site-rule-patterns">
            {patterns.slice(0, 2).map(pattern => <PatternBadge key={pattern} pattern={pattern} />)}
            {patterns.length > 2 && <span className="site-rule-badge">{`+${patterns.length - 2}`}</span>}
          </span>
        </button>
        {onToggle && (
          <Switch
            checked={!!enabled}
            disabled={pending}
            aria-label={i18n.t("siteRules.toggle", [rule.id])}
            onCheckedChange={onToggle}
          />
        )}
      </div>
      {expanded && (
        <div className="site-rule-details" id={detailsId}>
          <div className="site-rule-details-toolbar">
            <div className="site-rule-full-patterns">
              {patterns.map(pattern => <PatternBadge key={pattern} pattern={pattern} expanded />)}
            </div>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              {i18n.t(copyStatus === "copied" ? "siteRules.copied" : "siteRules.copy")}
            </Button>
          </div>
          {copyStatus === "failed" && <p className="site-rules-error" role="alert">{i18n.t("siteRules.copyFailed")}</p>}
          <pre className="site-rule-json"><code>{json}</code></pre>
        </div>
      )}
    </div>
  )
}

export function SiteRulesSection({ onBackToReading }: { onBackToReading?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [rulesConfig, setRulesConfig] = useAtom(configFieldsAtomMap.siteRules)
  const [tab, setTab] = useState<RulesTab>("builtin")
  const [search, setSearch] = useState("")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState(false)
  const [editing, setEditing] = useState(false)
  // A null draft follows storage; entered text survives tab switches and external writes.
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([])
  const tabId = useId()
  const editorId = useId()
  const errorId = useId()
  const storedJson = JSON.stringify(rulesConfig.userRules, null, 2)
  const editorText = draft ?? storedJson
  const debouncedText = useDebouncedValue(editorText, 500)
  const validating = editorText !== debouncedText
  const validation = useMemo(() => validateUserRulesDocument(debouncedText), [debouncedText])
  const dirty = editorText !== storedJson
  const invalid = !validating && !validation.ok
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return BUILT_IN_SITE_RULES.filter(rule => !query || `${rule.id} ${rule.description ?? ""} ${patternsFor(rule).join(" ")}`.toLowerCase().includes(query))
  }, [search])
  const disabled = new Set(normalizeDisabledBuiltInRuleIds(rulesConfig.disabledBuiltInRules))
  const enabledCount = BUILT_IN_SITE_RULES.filter(rule => !disabled.has(rule.id)).length

  const changeSearch = (value: string) => {
    setSearch(value)
    setVisibleCount(PAGE_SIZE)
  }

  const toggle = async (id: string, enabled: boolean) => {
    if (toggling)
      return
    setToggling(true)
    setToggleError(false)
    const next = new Set(normalizeDisabledBuiltInRuleIds(rulesConfig.disabledBuiltInRules))
    if (enabled)
      next.delete(id)
    else
      next.add(id)
    try {
      await setRulesConfig({ disabledBuiltInRules: [...next] })
    }
    catch {
      setToggleError(true)
    }
    finally {
      setToggling(false)
    }
  }

  const openEditor = () => {
    setDraft(null)
    setSaveError(false)
    setEditing(true)
  }
  const cancel = () => {
    setDraft(null)
    setSaveError(false)
    setEditing(false)
  }
  const save = async () => {
    if (saving || validating || !dirty || !validation.ok)
      return
    setSaving(true)
    setSaveError(false)
    try {
      await setRulesConfig({ userRules: validation.rules })
      setDraft(null)
      setEditing(false)
    }
    catch {
      setSaveError(true)
    }
    finally {
      setSaving(false)
    }
  }
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: RulesTab) => {
    const index = TABS.indexOf(current)
    let next: number
    if (event.key === "ArrowRight")
      next = (index + 1) % TABS.length
    else if (event.key === "ArrowLeft")
      next = (index + TABS.length - 1) % TABS.length
    else if (event.key === "Home")
      next = 0
    else if (event.key === "End")
      next = TABS.length - 1
    else
      return
    event.preventDefault()
    setTab(TABS[next])
    tabsRef.current[next]?.focus()
  }

  return (
    <section id="site-rules" className="settings-section settings-site-rules">
      <a href="#reading" className="site-rules-back" aria-label={i18n.t("siteRules.backToReading")} onClick={onBackToReading}>
        <span aria-hidden="true">←</span>
        {i18n.t("options.reading.title")}
      </a>
      <h1 className="settings-page-title">{i18n.t("siteRules.title")}</h1>
      <div className="site-rules-tabs" role="tablist" aria-label={i18n.t("siteRules.tabsLabel")}>
        {TABS.map((value, index) => (
          <button
            type="button"
            key={value}
            ref={(node) => { tabsRef.current[index] = node }}
            className="site-rules-tab"
            role="tab"
            id={`${tabId}-${value}-tab`}
            aria-label={i18n.t(value === "builtin" ? "siteRules.builtIn" : "siteRules.custom")}
            aria-selected={tab === value}
            aria-controls={`${tabId}-${value}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={event => handleTabKey(event, value)}
          >
            {i18n.t(value === "builtin" ? "siteRules.builtIn" : "siteRules.custom")}
            <span className="site-rules-tab-count" aria-hidden="true">{value === "builtin" ? BUILT_IN_SITE_RULES.length : rulesConfig.userRules.length}</span>
          </button>
        ))}
      </div>
      <p className="site-rules-source">
        {i18n.t("siteRules.sourceIntro")}
        {" "}
        <a href="https://github.com/mengxi-ream/read-frog" target="_blank" rel="noreferrer">{i18n.t("siteRules.sourceProject")}</a>
        {" · "}
        <a href="https://github.com/mengxi-ream/read-frog/blob/main/LICENSE" target="_blank" rel="noreferrer">GPL-3.0</a>
        {" · "}
        {i18n.t("siteRules.sourceMaintainer")}
      </p>
      <div role="tabpanel" className="site-rules-pane" id={`${tabId}-builtin-panel`} aria-labelledby={`${tabId}-builtin-tab`} hidden={tab !== "builtin"}>
        <p className="site-rules-description">{i18n.t("siteRules.builtInDescription")}</p>
        <div className="site-rules-toolbar">
          <input
            className="site-rules-search"
            type="search"
            value={search}
            aria-label={i18n.t("siteRules.search")}
            placeholder={i18n.t("siteRules.search")}
            onChange={event => changeSearch(event.target.value)}
          />
          <span className="site-rules-count">{i18n.t("siteRules.enabledCount", [enabledCount, BUILT_IN_SITE_RULES.length])}</span>
        </div>
        {toggleError && <p role="alert" className="site-rules-error site-rules-write-error">{i18n.t("siteRules.errors.saveFailed")}</p>}
        <div className="site-rules-list">
          {filtered.length
            ? filtered.slice(0, visibleCount).map(rule => (
                <RuleRow key={rule.id} rule={rule} enabled={!disabled.has(rule.id)} pending={toggling} onToggle={enabled => void toggle(rule.id, enabled)} />
              ))
            : (
                <div className="site-rules-empty">
                  <h2>{i18n.t("siteRules.noMatches")}</h2>
                  <p>{i18n.t("siteRules.searchHelp")}</p>
                </div>
              )}
        </div>
        <div className="site-rules-list-footer">
          <span className="site-rules-count">{i18n.t("siteRules.showingCount", [Math.min(visibleCount, filtered.length), filtered.length])}</span>
          {visibleCount < filtered.length && <Button variant="outline" size="sm" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>{i18n.t("siteRules.showMore")}</Button>}
        </div>
        <p className="site-rules-note">{i18n.t("siteRules.immediate")}</p>
      </div>
      <div role="tabpanel" className="site-rules-pane" id={`${tabId}-custom-panel`} aria-labelledby={`${tabId}-custom-tab`} hidden={tab !== "custom"}>
        {editing
          ? (
              <div className="site-rules-editor">
                <div className="site-rules-editor-header">
                  <h2>{i18n.t("siteRules.editorTitle")}</h2>
                  <span className="site-rules-count">{i18n.t("siteRules.characterCount", [editorText.length, MAX_SITE_RULES_JSON_LENGTH])}</span>
                </div>
                <p className="site-rules-description">{i18n.t("siteRules.editorDescription")}</p>
                <textarea
                  id={editorId}
                  className="site-rules-textarea"
                  aria-label={i18n.t("siteRules.editorLabel")}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid || saveError ? errorId : undefined}
                  value={editorText}
                  spellCheck={false}
                  disabled={saving}
                  onChange={(event) => {
                    const value = event.target.value
                    setDraft(value === storedJson ? null : value)
                    setSaveError(false)
                  }}
                />
                {(invalid || saveError) && (
                  <div id={errorId} role="alert" className="site-rules-validation-error">
                    <p>{i18n.t(saveError ? "siteRules.errors.saveFailed" : `siteRules.errors.${validation.ok ? "schema" : validation.kind}`)}</p>
                    {!validation.ok && !validating && !saveError && (
                      <ul>
                        {validation.issues.slice(0, 5).map(issue => (
                          <li key={`${issue.path}:${issue.message}`}>
                            <code>{issue.path}</code>
                            {`: ${issue.message}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="site-rules-editor-actions">
                  <span className={`site-rules-editor-status${!validating && validation.ok && dirty ? " site-rules-valid" : ""}`} role="status">
                    {i18n.t(validating ? "siteRules.validating" : dirty ? validation.ok ? "siteRules.valid" : "siteRules.unsaved" : "siteRules.saved")}
                  </span>
                  <div className="site-rules-buttons">
                    <Button variant="outline" size="sm" disabled={saving} onClick={cancel}>{i18n.t("siteRules.cancel")}</Button>
                    <Button size="sm" disabled={saving || validating || !validation.ok || !dirty} onClick={() => void save()}>{i18n.t(saving ? "siteRules.saving" : "siteRules.save")}</Button>
                  </div>
                </div>
                <details className="site-rules-example">
                  <summary>{i18n.t("siteRules.example")}</summary>
                  <pre className="site-rule-json"><code>{EXAMPLE}</code></pre>
                </details>
                <p className="site-rules-note">{i18n.t("siteRules.customPriority")}</p>
              </div>
            )
          : (
              <>
                <p className="site-rules-description">{i18n.t("siteRules.customDescription")}</p>
                {rulesConfig.userRules.length
                  ? (
                      <>
                        <div className="site-rules-custom-header">
                          <span className="site-rules-count">{i18n.t("siteRules.customCount", [rulesConfig.userRules.length])}</span>
                          <Button variant="outline" size="sm" onClick={openEditor}>{i18n.t("siteRules.edit")}</Button>
                        </div>
                        <div className="site-rules-list">
                          {rulesConfig.userRules.map(rule => <RuleRow key={rule.id} rule={rule} />)}
                        </div>
                      </>
                    )
                  : (
                      <div className="site-rules-list site-rules-empty">
                        <h2>{i18n.t("siteRules.emptyTitle")}</h2>
                        <p>{i18n.t("siteRules.emptyDescription")}</p>
                        <Button size="sm" onClick={openEditor}>{i18n.t("siteRules.add")}</Button>
                      </div>
                    )}
              </>
            )}
      </div>
    </section>
  )
}
