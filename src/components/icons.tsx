import type { SVGProps } from "react"

type IconProps = Omit<SVGProps<SVGSVGElement>, "stroke"> & { stroke?: number | string }

/** Outline icons inlined so the extension never needs a remote icon request. */
function icon(paths: string[]) {
  return function Icon({ stroke = 2, className, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...props}
      >
        {paths.map(d => <path key={d} d={d} />)}
      </svg>
    )
  }
}

export const IconAlertCircle = icon(["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 8v4", "M12 16h.01"])
export const IconArrowRight = icon(["M5 12l14 0", "M13 18l6 -6", "M13 6l6 6"])
export const IconCheck = icon(["M5 12l5 5l10 -10"])
export const IconArrowLeft = icon(["M20 12H5", "M11 6l-6 6 6 6"])
export const IconPlus = icon(["M12 5v14", "M5 12h14"])
export const IconPencil = icon(["m16 4 4 4-11 11-5 1 1-5Z", "m14 6 4 4"])
export const IconCode = icon(["m8 5-6 7 6 7", "m16 5 6 7-6 7", "m14 3-4 18"])
export const IconKey = icon(["M12 8a4 4 0 1 0-8 0a4 4 0 0 0 8 0", "m11 11 9 9", "m16 16 3-3", "m18 18 3-3"])
export const IconLink = icon(["m10 13 4-4", "m8 15-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0", "m16 9 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"])
export const IconEye = icon(["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z", "M15 12a3 3 0 1 0-6 0a3 3 0 0 0 6 0"])
export const IconEyeOff = icon(["M3 3l18 18", "M10.6 5.1 12 5c6 0 10 7 10 7a20 20 0 0 1-3.1 3.7", "M6.1 6.1A20 20 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.9-1.9"])
export const IconCpu = icon(["M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z", "M9 2v4", "M15 2v4", "M9 18v4", "M15 18v4", "M2 9h4", "M2 15h4", "M18 9h4", "M18 15h4", "M9 9h6v6H9Z"])
export const IconList = icon(["M9 6h12", "M9 12h12", "M9 18h8", "M3 6h.01", "M3 12h.01", "M3 18h.01"])
export const IconBolt = icon(["m13 2-9 12h7l-1 8 10-12h-7Z"])
export const IconDots = icon(["M5 12h.01", "M12 12h.01", "M19 12h.01"])
export const IconX = icon(["m6 6 12 12", "M6 18 18 6"])
export const IconServer = icon(["M5 3h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M5 14h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Z", "M7 6.5h.01", "M7 17.5h.01", "M12 6.5h5", "M12 17.5h5"])
export const IconSpark = icon(["m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"])
export const IconLoader = icon(["M12 3a9 9 0 1 1-9 9"])
export const IconTrash = icon(["M3 6h18", "M9 6V3h6v3", "M6 6l1 15h10l1-15", "M10 10v7", "M14 10v7"])
export const IconChevronDown = icon(["M6 9l6 6l6 -6"])
export const IconCopy = icon([
  "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
  "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",
])
export const IconSettings = icon([
  "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065",
  "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
])
