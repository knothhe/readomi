import type { ComponentProps } from "react"
import { IconArrowRight } from "@/components/icons"

export function PopupHelpAction({ children, indicator = "arrow", ...props }: ComponentProps<"button"> & { indicator?: "arrow" | "external" }) {
  return (
    <button
      {...props}
      type="button"
      className="flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded bg-transparent px-0.5 py-1 text-left text-[12px] leading-5 text-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
    >
      <span>{children}</span>
      {indicator === "external" ? <span aria-hidden="true" className="shrink-0">↗</span> : <IconArrowRight aria-hidden="true" className="size-3.5" stroke={1.5} />}
    </button>
  )
}
