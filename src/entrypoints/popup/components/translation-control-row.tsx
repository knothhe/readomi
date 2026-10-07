import type { ReactNode } from "react"
import { cn } from "@/utils/styles/utils"
import { PopupStateFade } from "./popup-state-fade"

interface TranslationControlRowProps {
  label: string
  hint?: ReactNode
  control: ReactNode
  controlId?: string
  disabled?: boolean
}

/** Translation features share the same label, hint and action layout. */
export function TranslationControlRow({ label, hint, control, controlId, disabled = false }: TranslationControlRowProps) {
  const labelClass = "truncate text-[13px] leading-[18px]"

  return (
    <PopupStateFade paused={disabled} className="popup-feature-row flex min-h-[42px] items-center justify-between gap-3" data-paused={disabled || undefined}>
      <div className={cn("flex min-w-0 items-center gap-2", disabled && "text-muted-foreground")}>
        {controlId
          ? <label htmlFor={controlId} title={label} className={labelClass}>{label}</label>
          : <span title={label} className={labelClass}>{label}</span>}
        {hint}
      </div>
      {control}
    </PopupStateFade>
  )
}
