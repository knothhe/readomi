import { useAtom } from "jotai"
import { useId } from "react"
import { i18n } from "#imports"
import { AppearanceModeControl } from "@/components/appearance-mode-control"
import { toast } from "@/components/toast"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { COLOR_PALETTES, COLOR_THEMES } from "@/utils/color-theme"
import { UI_LANGUAGE_NAMES, UI_LANGUAGES } from "@/utils/ui-language-options"
import { SettingsGroup, SettingsRow, SettingsSection } from "../components/settings-section"
import { SettingsSelect } from "../components/settings-select"

const LABELS = {
  terra: "options.appearance.colors.terra",
  plum: "options.appearance.colors.plum",
  amber: "options.appearance.colors.amber",
  teal: "options.appearance.colors.teal",
} as const

export function AppearanceSection() {
  const [appearance, setAppearance] = useAtom(configFieldsAtomMap.appearance)
  const [ui, setUI] = useAtom(configFieldsAtomMap.ui)
  const languageId = useId()
  return (
    <SettingsSection id="appearance" title={i18n.t("options.appearance.title")}>
      <div className="options-two-column">
        <div className="options-controls">
          <SettingsGroup caption={i18n.t("options.appearance.preferences")}>
            <SettingsRow
              label={i18n.t("uiLanguage.title")}
              htmlFor={languageId}
              control={(
                <SettingsSelect
                  id={languageId}
                  className="w-44"
                  value={ui.language}
                  options={UI_LANGUAGES.map(value => ({ value, label: value === "browser" ? i18n.t("uiLanguage.browser") : UI_LANGUAGE_NAMES[value] }))}
                  onValueChange={(value) => {
                    const saveFailed = i18n.t("uiLanguage.saveFailed")
                    void setUI({ language: value as typeof ui.language }).catch(() => toast.error(saveFailed))
                  }}
                />
              )}
            />
            <SettingsRow label={i18n.t("appearanceMode.title")} control={<AppearanceModeControl />} />
          </SettingsGroup>
          <SettingsGroup caption={i18n.t("options.appearance.colorTheme")} className="gap-4 divide-y-0 p-5">
            <div role="radiogroup" aria-label={i18n.t("options.appearance.colorTheme")} className="grid grid-cols-4 gap-2">
              {COLOR_THEMES.map((color, index) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={appearance.colorTheme === color}
                  tabIndex={appearance.colorTheme === color ? 0 : -1}
                  className={`flex min-w-0 flex-col items-center gap-3 rounded-[10px] border px-2 py-4 text-xs outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring ${appearance.colorTheme === color ? "border-primary bg-accent/30" : "border-border bg-card hover:border-primary/50"}`}
                  onClick={() => void setAppearance({ colorTheme: color }).catch(() => toast.error(i18n.t("options.appearance.saveFailed")))}
                  onKeyDown={(event) => {
                    let next = index
                    if (event.key === "ArrowRight" || event.key === "ArrowDown")
                      next = (index + 1) % COLOR_THEMES.length
                    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                      next = (index + COLOR_THEMES.length - 1) % COLOR_THEMES.length
                    else if (event.key === "Home")
                      next = 0
                    else if (event.key === "End")
                      next = COLOR_THEMES.length - 1
                    else return
                    event.preventDefault()
                    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=radio]")
                    buttons?.[next]?.focus()
                    buttons?.[next]?.click()
                  }}
                >
                  <span aria-hidden="true" className="size-7 rounded-full" style={{ backgroundColor: COLOR_PALETTES[color].primary }} />
                  <span>{i18n.t(LABELS[color])}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{i18n.t("options.appearance.description")}</p>
          </SettingsGroup>
        </div>
        <aside className="options-preview-column">
          <h3 className="options-preview-title">{i18n.t("options.preview")}</h3>
          <div className="options-preview-card p-5">
            <div className="flex flex-col gap-5 rounded-[10px] border border-border bg-card px-5 py-7">
              <p className="font-serif text-[27px] leading-[1.3] tracking-[-.4px]">Reading and experience train your model of the world.</p>
              <p className="border-l-2 border-brand pl-3 text-[13px] leading-[1.9]" lang="zh">阅读和经历训练的是你对世界的模型。</p>
              <div className="mt-1 flex h-10 items-center justify-center gap-2 self-start rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground">
                {i18n.t("popup.translate")}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-3.5"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </SettingsSection>
  )
}
