import type { ReactNode } from "react"
import type { TranslationTask } from "@/types/config/translate"
import { TranslationModelLink } from "@/components/translation-model-link"
import { cn } from "@/utils/styles/utils"
import { PopupStateFade } from "./popup-state-fade"

interface TranslationControlRowProps {
  label: string
  hint?: ReactNode
  control: ReactNode
  controlId?: string
  disabled?: boolean
  task?: TranslationTask
}

/** Translation features share the same label, hint and action layout. */
export function TranslationControlRow({ label, hint, control, controlId, disabled = false, task }: TranslationControlRowProps) {
  const labelClass = "truncate text-[13px] leading-[18px]"

  return (
    <PopupStateFade paused={disabled} className={cn("popup-feature-row flex items-center justify-between gap-3", task ? "min-h-[60px]" : "min-h-[42px]")} data-paused={disabled || undefined}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className={cn("flex min-w-0 items-center gap-2", disabled && "text-muted-foreground")}>
          {controlId
            ? <label htmlFor={controlId} title={label} className={labelClass}>{label}</label>
            : <span title={label} className={labelClass}>{label}</span>}
          {hint}
        </div>
        {task && <TranslationModelLink task={task} />}
      </div>
      {control}
    </PopupStateFade>
  )
}
