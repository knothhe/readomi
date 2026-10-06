import type { ReactNode } from "react"

interface TranslationControlRowProps {
  label: string
  hint?: ReactNode
  control: ReactNode
  controlId?: string
}

/** Translation features share the same label, hint and action layout. */
export function TranslationControlRow({ label, hint, control, controlId }: TranslationControlRowProps) {
  const labelClass = "truncate text-[13px] leading-[18px]"

  return (
    <div className="flex min-h-[42px] items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {controlId
          ? <label htmlFor={controlId} title={label} className={labelClass}>{label}</label>
          : <span title={label} className={labelClass}>{label}</span>}
        {hint}
      </div>
      {control}
    </div>
  )
}
