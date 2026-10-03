import type { CSSProperties } from "react"
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
  "decrementLabel": string
  "incrementLabel": string
}

/** Keeps the browser's range semantics and arrow keys, with visible progress and precise step controls. */
export function SettingsSlider({ id, value, min, max, step = 1, onValueChange, disabled, className, "aria-label": ariaLabel, unit = "", decrementLabel, incrementLabel }: SettingsSliderProps) {
  return (
    <div className={cn("settings-slider", className)}>
      <div className="settings-slider-toolbar">
        <output htmlFor={id} className="settings-slider-value">
          {value}
          <span>{unit}</span>
        </output>
        <div className="settings-slider-steps">
          <button type="button" aria-label={decrementLabel} disabled={disabled || value <= min} onClick={() => onValueChange(Math.max(min, value - step))}>−</button>
          <button type="button" aria-label={incrementLabel} disabled={disabled || value >= max} onClick={() => onValueChange(Math.min(max, value + step))}>+</button>
        </div>
      </div>
      <input
        id={id}
        type="range"
        aria-label={ariaLabel}
        aria-valuetext={`${value}${unit ? ` ${unit}` : ""}`}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ "--settings-range-progress": `${100 * (value - min) / (max - min)}%` } as CSSProperties}
        onChange={event => onValueChange(Number(event.target.value))}
        className="settings-slider-input"
      />
      <div className="settings-slider-limits" aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
