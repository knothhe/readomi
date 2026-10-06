import { useAtom, useAtomValue } from "jotai"
import { i18n } from "#imports"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { sendMessage } from "@/utils/message"
import { formatHotkey } from "@/utils/os"
import { isPageTranslationShortcutEmpty } from "@/utils/page-translation-shortcut"
import { cn } from "@/utils/styles/utils"
import { activeTabAtom, pageTranslationEnabledAtom, translationProgressAtom } from "../atoms"
import { PageRecoveryActions } from "./page-recovery-actions"
import { TranslationControlRow } from "./translation-control-row"

export async function setPageTranslation(tabId: number, enabled: boolean) {
  await sendMessage("tryToSetEnablePageTranslationByTabId", { tabId, enabled })
}

function ProgressLine() {
  const progress = useAtomValue(translationProgressAtom)
  if (!progress || progress.total === 0)
    return null

  const finished = progress.done >= progress.total
  const ratio = Math.min(1, progress.done / progress.total)

  return (
    <div className="flex flex-col gap-1.5 px-0.5">
      <div className="flex justify-between text-[12px] leading-4 text-muted-foreground">
        <span>
          {finished ? i18n.t("popup.translated") : i18n.t("popup.translating")}
          {progress.failed > 0 && ` · ${i18n.t("popup.failedCount", [String(progress.failed)])}`}
        </span>
        <span className="tabular-nums">
          {finished
            ? i18n.t("popup.paragraphCount", [String(progress.total)])
            : `${progress.done} / ${progress.total}`}
        </span>
      </div>
      <div aria-hidden="true" className="h-0.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", finished ? "bg-muted-foreground/50" : "bg-brand")}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}

export function TranslateButton() {
  const activeTab = useAtomValue(activeTabAtom)
  const [enabled, setEnabled] = useAtom(pageTranslationEnabledAtom)
  const translateConfig = useAtomValue(configFieldsAtomMap.translate)
  const progress = useAtomValue(translationProgressAtom)

  const shortcut = translateConfig.page.shortcut
  const shortcutHint = isPageTranslationShortcutEmpty(shortcut) ? null : formatHotkey(shortcut)

  const toggle = () => {
    if (activeTab.id === null)
      return
    const next = !enabled
    setEnabled(next)
    void setPageTranslation(activeTab.id, next)
  }

  return (
    <div>
      <TranslationControlRow
        label={i18n.t("popup.pageText")}
        hint={shortcutHint && <span className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">{shortcutHint}</span>}
        control={(
          <button
            type="button"
            aria-label={enabled ? i18n.t("popup.showOriginal") : i18n.t("popup.translate")}
            onClick={toggle}
            disabled={!activeTab.translatable}
            className="h-7 min-w-[62px] shrink-0 rounded-full bg-brand px-3 text-[12px] font-medium text-brand-foreground transition-colors outline-none hover:bg-brand/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enabled ? i18n.t("popup.showOriginal") : i18n.t("popup.translateAction")}
          </button>
        )}
      />
      {(!activeTab.translatable || (enabled && !!progress?.total)) && (
        <div className="flex flex-col gap-2 pb-2.5">
          {!activeTab.translatable && (
            <p className="px-0.5 text-[12px] leading-4 text-muted-foreground">{i18n.t("popup.notTranslatable")}</p>
          )}
          {enabled && <ProgressLine />}
        </div>
      )}
      {enabled && <div className="pb-2"><PageRecoveryActions /></div>}
    </div>
  )
}
