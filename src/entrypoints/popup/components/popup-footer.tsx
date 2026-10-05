import type { KeyboardEvent } from "react"
import type { ProviderConfig } from "@/types/config/provider"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useEffect, useId, useRef, useState } from "react"
import { i18n } from "#imports"
import { IconCheck, IconChevronDown, IconSettings } from "@/components/icons"
import { configAtom } from "@/utils/atoms/config"
import { featureProviderConfigAtom } from "@/utils/atoms/provider"
import { selectProviderAtom } from "@/utils/atoms/service"
import { PROVIDER_ITEMS } from "@/utils/constants/providers"
import { openOptionsPage } from "@/utils/navigation"
import { isProviderReady } from "@/utils/service-management"
import { cn } from "@/utils/styles/utils"
import { ClearTranslationCacheButton } from "./clear-translation-cache-button"
import { WordPrefixEmphasisToggle } from "./word-prefix-emphasis-toggle"

function describeProvider(provider: ProviderConfig): string {
  const modelId = provider.model.trim()
  const displayName = provider.name || PROVIDER_ITEMS[provider.provider].name
  return modelId ? `${displayName} · ${modelId}` : displayName
}

type SwitchFeedback = { kind: "success", provider: ProviderConfig } | { kind: "error", providerId: string }

/** One persisted selection is shared by the popup, settings and translation requests. */
export function PopupFooter() {
  const current = useAtomValue(featureProviderConfigAtom("translate"))
  const config = useAtomValue(configAtom)
  const selectProvider = useSetAtom(selectProviderAtom)
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<{ previous: ProviderConfig | undefined } | null>(null)
  const [feedback, setFeedback] = useState<SwitchFeedback | null>(null)
  const savingRef = useRef(false)
  const restoreFocusRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const shown = pending ? pending.previous : current
  const ready = !!shown && isProviderReady(shown)
  const displayName = shown ? shown.name || PROVIDER_ITEMS[shown.provider].name : ""
  const serviceLabel = shown
    ? ready ? displayName : `${displayName} · ${i18n.t("popup.provider.missingKey")}`
    : i18n.t("popup.provider.none")
  const providers = config.providersConfig.filter(isProviderReady)

  useEffect(() => {
    if (!open)
      return
    const menu = menuRef.current
    const selected = menu?.querySelector<HTMLButtonElement>("[aria-checked='true']")
    ;(selected ?? menu?.querySelector<HTMLButtonElement>("button"))?.focus()
    const closeOutside = (event: Event) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target))
        setOpen(false)
    }
    document.addEventListener("pointerdown", closeOutside, true)
    document.addEventListener("focusin", closeOutside)
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true)
      document.removeEventListener("focusin", closeOutside)
    }
  }, [open])

  useEffect(() => {
    if (feedback?.kind !== "success")
      return
    const timer = setTimeout(setFeedback, 5000, null)
    return () => clearTimeout(timer)
  }, [feedback])

  useEffect(() => {
    if (!pending && restoreFocusRef.current) {
      restoreFocusRef.current = false
      triggerRef.current?.focus()
    }
  }, [pending])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const switchTo = async (providerId: string) => {
    if (savingRef.current)
      return
    const latest = store.get(configAtom)
    if (providerId === latest.translate.providerId) {
      close()
      return
    }
    savingRef.current = true
    setPending({ previous: latest.providersConfig.find(provider => provider.id === latest.translate.providerId) })
    setFeedback(null)
    close()
    try {
      await selectProvider(providerId)
      const selected = store.get(configAtom).providersConfig.find(provider => provider.id === providerId)
      if (selected)
        setFeedback({ kind: "success", provider: selected })
    }
    catch {
      setFeedback({ kind: "error", providerId })
    }
    finally {
      savingRef.current = false
      restoreFocusRef.current = true
      setPending(null)
    }
  }

  const menuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      close()
      return
    }
    if (event.key === "Tab") {
      setOpen(false)
      return
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
      return
    event.preventDefault()
    if (!open) {
      setOpen(true)
      return
    }
    const items = [...menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []]
    const index = items.findIndex(item => item === document.activeElement)
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <>
      {feedback && (
        <aside
          role={feedback.kind === "error" ? "alert" : "status"}
          className={cn("mx-3.5 mb-3 rounded-lg border border-border bg-card px-[11px] py-2.5 text-[11px] leading-[17px] text-muted-foreground", feedback.kind === "error" && "border-destructive/25 bg-destructive/5")}
        >
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <strong className={cn("text-[12px] font-medium text-foreground", feedback.kind === "error" && "text-destructive")}>
              {feedback.kind === "success"
                ? i18n.t("popup.serviceSwitch.switched", [feedback.provider.name])
                : i18n.t("popup.serviceSwitch.failed")}
            </strong>
            {feedback.kind === "error" && (
              <button type="button" disabled={!!pending} onClick={() => void switchTo(feedback.providerId)} className="text-primary focus-visible:ring-3 focus-visible:ring-ring/50">
                {i18n.t("popup.serviceSwitch.retry")}
              </button>
            )}
          </div>
          <p>
            {feedback.kind === "success"
              ? i18n.t("popup.serviceSwitch.switchedDescription")
              : i18n.t("popup.serviceSwitch.failedDescription", [displayName || i18n.t("popup.provider.none")])}
          </p>
        </aside>
      )}
      <footer aria-busy={!!pending} className="relative flex items-center justify-between gap-2 border-t border-border py-1.5 pr-2.5 pl-3.5">
        <button
          ref={triggerRef}
          type="button"
          disabled={!!pending}
          title={shown && ready ? describeProvider(shown) : serviceLabel}
          aria-label={i18n.t("popup.serviceSwitch.switchLabel", [serviceLabel])}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
          onKeyDown={menuKeyDown}
          className={cn("flex h-7 min-w-0 items-center gap-1.5 rounded-md pr-1.5 pl-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60", open && "bg-secondary text-foreground")}
        >
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-success" : "bg-attention")} />
          <span className="truncate">{serviceLabel}</span>
          <IconChevronDown aria-hidden="true" className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} stroke={1.75} />
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <ClearTranslationCacheButton />
          <WordPrefixEmphasisToggle />
          <button
            type="button"
            aria-label={i18n.t("popup.settings")}
            title={i18n.t("popup.settings")}
            onClick={() => void openOptionsPage()}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <IconSettings className="size-4" stroke={1.75} />
          </button>
        </div>
        {open && (
          <div ref={menuRef} id={menuId} role="menu" aria-label={i18n.t("popup.serviceSwitch.title")} onKeyDown={menuKeyDown} className="absolute right-3.5 bottom-[46px] left-3.5 z-50 rounded-[10px] border border-border bg-card p-1.25 shadow-[0_8px_32px_#302b2924]">
            <h2 className="px-2.5 pt-2 pb-2.25 text-[11px] leading-4 font-medium text-muted-foreground">{i18n.t("popup.serviceSwitch.title")}</h2>
            <div className="max-h-64 overflow-y-auto">
              {providers.map(provider => (
                <button
                  key={provider.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={provider.id === current?.id}
                  title={describeProvider(provider)}
                  onClick={() => void switchTo(provider.id)}
                  className={cn("flex min-h-[51px] w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none", provider.id === current?.id && "bg-secondary")}
                >
                  <span className="flex min-w-0 flex-col gap-0.75">
                    <span className="truncate text-[12px] leading-4 font-medium">{provider.name}</span>
                    <span className="truncate text-[10px] leading-3.5 text-muted-foreground">{provider.model}</span>
                  </span>
                  <IconCheck aria-hidden="true" className={cn("size-3.5 shrink-0 text-primary", provider.id !== current?.id && "invisible")} stroke={1.75} />
                </button>
              ))}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close()
                void openOptionsPage({ section: "service" })
              }}
              className="mt-1.25 flex w-full items-center justify-between border-t border-border px-2.5 pt-2.75 pb-1.75 text-[12px] leading-4 text-muted-foreground hover:text-primary focus-visible:text-primary focus-visible:outline-none"
            >
              {i18n.t("popup.serviceSwitch.manage")}
              <IconChevronDown aria-hidden="true" className="size-3.25 -rotate-90" stroke={1.75} />
            </button>
          </div>
        )}
      </footer>
    </>
  )
}
