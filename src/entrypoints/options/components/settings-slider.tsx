import type { CSSProperties } from "react"
import { useId, useState } from "react"
import { cn } from "@/utils/styles/utils"

interface SettingsSliderProps {
  "id"?: string
  "value": number
  "min": number
  "max": number
  "step"?: number
  "onValueChange": (value: number) => void
  "disabled"?: boolean
  "className"?: string
  "aria-label"?: string
  "unit"?: string
  "showLimits"?: boolean
  "decrementLabel": string
  "incrementLabel": string
}

/** Keeps the browser's range semantics and arrow keys, with visible progress and precise step controls. */
export function SettingsSlider({ id, value, min, max, step = 1, onValueChange, disabled, className, "aria-label": ariaLabel, unit = "", showLimits = true, decrementLabel, incrementLabel }: SettingsSliderProps) {
  const generatedId = useId()
  const rangeId = id ?? generatedId
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft.trim() !== "") {
      const parsed = Number(draft)
      if (Number.isFinite(parsed)) {
        const next = Math.max(min, Math.min(max, step >= 1 ? Math.round(parsed) : parsed))
        if (next !== value)
          onValueChange(next)
      }
    }
    setDraft(null)
  }
  const change = (next: number) => {
    setDraft(null)
    onValueChange(Number(next.toFixed(5)))
  }
  return (
    <div className={cn("settings-slider", className)} data-disabled={disabled || undefined}>
      <div className="settings-slider-controls">
        <button type="button" className="settings-slider-step" aria-label={decrementLabel} disabled={disabled || value <= min} onClick={() => change(Math.max(min, value - step))}>−</button>
        <input
          id={rangeId}
          type="range"
          aria-label={ariaLabel}
          aria-valuetext={`${value}${unit ? ` ${unit}` : ""}`}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={{ "--settings-range-progress": `${100 * (value - min) / (max - min)}%` } as CSSProperties}
          onChange={event => change(Number(event.target.value))}
          className="settings-slider-input"
        />
        <button type="button" className="settings-slider-step" aria-label={incrementLabel} disabled={disabled || value >= max} onClick={() => change(Math.min(max, value + step))}>+</button>
        <div className="settings-slider-number">
          <input
            type="number"
            aria-label={ariaLabel}
            min={min}
            max={max}
            step={step >= 1 ? 1 : "any"}
            value={draft ?? value}
            disabled={disabled}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                event.currentTarget.blur()
              if (event.key === "Escape")
                setDraft(null)
            }}
          />
          <span aria-hidden="true">{unit}</span>
        </div>
      </div>
      {showLimits && (
        <div className="settings-slider-limits" aria-hidden="true">
          <span>
            {min}
            {unit ? ` ${unit}` : ""}
          </span>
          <span>
            {max}
            {unit ? ` ${unit}` : ""}
          </span>
        </div>
      )}
    </div>
  )
}
