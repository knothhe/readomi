import type { ReactNode } from "react"

interface TranslationControlRowProps {
  label: string
  hint?: ReactNode
  control: ReactNode
  controlId?: string
}

/** Translation features share the same label, hint and action layout. */
export function TranslationControlRow({ label, hint, control, controlId }: TranslationControlRowProps) {
  const labelClass = "text-[13px] leading-[18px]"

  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-0.5 py-1">
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        {controlId
          ? <label htmlFor={controlId} className={labelClass}>{label}</label>
          : <span className={labelClass}>{label}</span>}
        {hint}
      </div>
      {control}
    </div>
  )
}
