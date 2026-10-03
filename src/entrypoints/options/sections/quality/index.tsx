import type { Config } from "@/types/config/config"
import { useAtom } from "jotai"
import { Fragment, useId, useState } from "react"
import { i18n } from "#imports"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { DEFAULT_TRANSLATE_PROMPT, DEFAULT_TRANSLATE_SYSTEM_PROMPT, getTokenCellText, INPUT, WEB_CONTENT, WEB_DESCRIPTION, WEB_SUMMARY, WEB_TITLE } from "@/utils/constants/prompt"
import { deepMerge } from "@/utils/object"
import { SettingsGroup, SettingsRow, SettingsSection } from "../../components/settings-section"
import { QualityHelp } from "./help"
import "./style.css"

type PromptsConfig = Config["translate"]["customPromptsConfig"]

interface PromptTexts {
  systemPrompt: string
  prompt: string
}

const CUSTOM_PROMPT_ID = "custom"
const DEFAULT_PROMPT: PromptTexts = { systemPrompt: DEFAULT_TRANSLATE_SYSTEM_PROMPT, prompt: DEFAULT_TRANSLATE_PROMPT }

function activePrompt({ promptId, patterns }: PromptsConfig): PromptTexts | null {
  const pattern = promptId ? patterns.find(p => p.id === promptId) : undefined
  return pattern ? { systemPrompt: pattern.systemPrompt, prompt: pattern.prompt } : null
}

/** Texts equal to the built-in prompt are stored as "no custom prompt", so later changes to the default reach this reader. */
function toPromptsConfig(texts: PromptTexts): PromptsConfig {
  if (texts.systemPrompt === DEFAULT_PROMPT.systemPrompt && texts.prompt === DEFAULT_PROMPT.prompt)
    return { promptId: null, patterns: [] }
  return { promptId: CUSTOM_PROMPT_ID, patterns: [{ id: CUSTOM_PROMPT_ID, name: "Custom", ...texts }] }
}

/** Page background is separate from the translation rules shared with subtitles. */
export function QualitySection() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.translate)
  const contextSwitchId = useId()
  const [editing, setEditing] = useState(false)
  const custom = activePrompt(translateConfig.customPromptsConfig)

  return (
    <SettingsSection id="quality" title={i18n.t("options.quality.title")} className="settings-quality">
      <div className="flex flex-col gap-6">
        <SettingsGroup caption={i18n.t("options.quality.web")}>
          <SettingsRow
            label={i18n.t("options.quality.context.title")}
            description={i18n.t("options.quality.context.purpose")}
            labelAddon={(
              <QualityHelp
                label={i18n.t("options.quality.context.title")}
                text={[i18n.t("options.quality.context.description"), i18n.t("options.quality.context.note")].join("\n")}
              />
            )}
            htmlFor={contextSwitchId}
            control={(
              <Switch
                id={contextSwitchId}
                checked={translateConfig.enableAIContentAware}
                onCheckedChange={checked => void setTranslateConfig(deepMerge(translateConfig, { enableAIContentAware: checked }))}
              />
            )}
          />
        </SettingsGroup>
        <SettingsGroup caption={i18n.t("options.quality.shared")}>
          {editing
            ? (
                <PromptEditor
                  initial={custom ?? DEFAULT_PROMPT}
                  isCustom={!!custom}
                  onCancel={() => setEditing(false)}
                  onApply={async (texts) => {
                    await setTranslateConfig({ ...translateConfig, customPromptsConfig: toPromptsConfig(texts) })
                    setEditing(false)
                  }}
                />
              )
            : (
                <div className="settings-prompt-header">
                  <div className="min-w-0">
                    <div className="settings-prompt-heading">
                      <span className="settings-prompt-title">{i18n.t("options.quality.prompt.title")}</span>
                      <span className="settings-prompt-status">
                        {custom ? i18n.t("options.quality.prompt.custom") : i18n.t("options.quality.prompt.default")}
                      </span>
                      <PromptHelp />
                    </div>
                    <p className="settings-prompt-purpose">{i18n.t("options.quality.prompt.purpose")}</p>
                  </div>
                  <Button variant="outline" className="settings-prompt-button" onClick={() => setEditing(true)}>
                    {i18n.t("options.quality.prompt.edit")}
                  </Button>
                </div>
              )}
        </SettingsGroup>
      </div>
    </SettingsSection>
  )
}

function PromptHelp() {
  return <QualityHelp label={i18n.t("options.quality.prompt.title")} text={[i18n.t("options.quality.prompt.description"), i18n.t("options.quality.prompt.background")].join("\n")} />
}

function WebVariablesHelp() {
  const variables = [
    { token: WEB_TITLE, label: i18n.t("options.quality.prompt.variables.pageTitle") },
    { token: WEB_DESCRIPTION, label: i18n.t("options.quality.prompt.variables.description") },
    { token: WEB_CONTENT, label: i18n.t("options.quality.prompt.variables.content") },
    { token: WEB_SUMMARY, label: i18n.t("options.quality.prompt.variables.summary") },
  ]
  return (
    <details className="settings-prompt-variables">
      <summary className="w-fit cursor-pointer">{i18n.t("options.quality.prompt.variables.title")}</summary>
      <dl className="settings-prompt-variable-list">
        {variables.map(({ token, label }) => (
          <Fragment key={token}>
            <dt>{label}</dt>
            <dd><code>{getTokenCellText(token)}</code></dd>
          </Fragment>
        ))}
      </dl>
      <p className="mt-2">{i18n.t("options.quality.prompt.variables.note")}</p>
    </details>
  )
}

function PromptTextarea({ label, help, value, variant, autoFocus, invalid, errorId, onChange }: {
  label: string
  help: string
  value: string
  variant: "system" | "template"
  autoFocus?: boolean
  invalid?: boolean
  errorId?: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="settings-prompt-field">
      <div className="settings-prompt-heading">
        <label htmlFor={id}>{label}</label>
        <QualityHelp label={label} text={help} />
      </div>
      <textarea
        id={id}
        value={value}
        spellCheck={false}
        autoFocus={autoFocus}
        rows={variant === "system" ? 12 : 4}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={event => onChange(event.target.value)}
        className={`settings-prompt-textarea settings-prompt-${variant}`}
      />
    </div>
  )
}

function PromptEditor({ initial, isCustom, onCancel, onApply }: {
  initial: PromptTexts
  isCustom: boolean
  onCancel: () => void
  onApply: (texts: PromptTexts) => Promise<void>
}) {
  const [texts, setTexts] = useState(initial)
  const [applying, setApplying] = useState(false)
  const errorId = useId()
  const inputToken = getTokenCellText(INPUT)
  const missingInput = !texts.prompt.includes(inputToken)
  const willBeCustom = toPromptsConfig(texts).promptId !== null
  const changed = texts.systemPrompt !== initial.systemPrompt || texts.prompt !== initial.prompt

  const apply = async () => {
    setApplying(true)
    try {
      await onApply(texts)
    }
    finally {
      setApplying(false)
    }
  }

  const label = (custom: boolean) => custom ? i18n.t("options.quality.prompt.custom") : i18n.t("options.quality.prompt.default")

  return (
    <div>
      <div className="settings-prompt-header">
        <div className="settings-prompt-heading">
          <span className="settings-prompt-title">{i18n.t("options.quality.prompt.title")}</span>
          <span className="settings-prompt-status">
            {willBeCustom === isCustom ? label(isCustom) : `${label(isCustom)} → ${label(willBeCustom)}`}
          </span>
          <PromptHelp />
        </div>
      </div>
      <div className="settings-prompt-editor">
        <PromptTextarea
          label={i18n.t("options.quality.prompt.system")}
          help={i18n.t("options.quality.prompt.systemDescription")}
          value={texts.systemPrompt}
          variant="system"
          autoFocus
          onChange={systemPrompt => setTexts(current => ({ ...current, systemPrompt }))}
        />
        <div className="settings-prompt-template-group">
          <PromptTextarea
            label={i18n.t("options.quality.prompt.template")}
            help={i18n.t("options.quality.prompt.tokens")}
            value={texts.prompt}
            variant="template"
            invalid={missingInput}
            errorId={errorId}
            onChange={prompt => setTexts(current => ({ ...current, prompt }))}
          />
          {missingInput && <p id={errorId} role="alert" className="settings-prompt-error">{i18n.t("options.quality.prompt.missingInput")}</p>}
        </div>
        <WebVariablesHelp />
      </div>
      <div className="settings-prompt-actions">
        <button
          type="button"
          onClick={() => setTexts(DEFAULT_PROMPT)}
          className="settings-prompt-restore"
        >
          {i18n.t("options.quality.prompt.restore")}
        </button>
        <Button variant="outline" className="settings-prompt-button" disabled={applying} onClick={onCancel}>
          {i18n.t("options.quality.prompt.cancel")}
        </Button>
        <Button className="settings-prompt-button" disabled={!changed || missingInput || applying} onClick={() => void apply()}>
          {i18n.t("options.quality.prompt.apply")}
        </Button>
      </div>
    </div>
  )
}
