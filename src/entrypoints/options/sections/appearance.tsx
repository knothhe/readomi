import { useAtom } from "jotai"
import { browser, i18n } from "#imports"
import { BrandIcon } from "@/components/brand-icon"
import { toast } from "@/components/toast"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { COLOR_THEMES, getThemeIconPath } from "@/utils/color-theme"
import { SettingsGroup, SettingsSection } from "../components/settings-section"

const LABELS = {
  terra: "options.appearance.colors.terra",
  plum: "options.appearance.colors.plum",
  amber: "options.appearance.colors.amber",
  teal: "options.appearance.colors.teal",
} as const

export function AppearanceSection() {
  const [appearance, setAppearance] = useAtom(configFieldsAtomMap.appearance)
  return (
    <SettingsSection id="appearance" title={i18n.t("options.appearance.title")}>
      <SettingsGroup className="gap-4 divide-y-0 p-[18px]">
        <div>
          <h3 className="font-semibold">{i18n.t("options.appearance.colorTheme")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{i18n.t("options.appearance.description")}</p>
        </div>
        <div role="radiogroup" aria-label={i18n.t("options.appearance.colorTheme")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COLOR_THEMES.map((color, index) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={appearance.colorTheme === color}
              tabIndex={appearance.colorTheme === color ? 0 : -1}
              className={`flex flex-col items-center gap-2.5 rounded-[10px] border-2 bg-card px-2 py-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring ${appearance.colorTheme === color ? "border-primary" : "border-border hover:border-primary/50"}`}
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
              <img src={new URL(getThemeIconPath(color, 48), browser.runtime.getURL("/")).href} alt="" className="size-12" />
              <span>{i18n.t(LABELS[color])}</span>
              <span aria-hidden="true" className="h-4 text-[11px] text-muted-foreground">{color === "terra" ? i18n.t("options.appearance.default") : "\u00A0"}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3.5 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center gap-2">
            <BrandIcon className="size-6" />
            <strong>Readomi</strong>
          </div>
          <p className="font-serif text-[15px]">Reading and experience train your model of the world.</p>
          <p className="border-l-2 border-brand pl-3 text-brand" lang="zh">阅读和经历训练的是你对世界的模型。</p>
          <div className="flex h-10 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground">{i18n.t("popup.translate")}</div>
        </div>
      </SettingsGroup>
    </SettingsSection>
  )
}
