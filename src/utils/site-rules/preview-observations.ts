import { getHostPreviewContext } from "./preview-config"

export interface SiteRulePreviewObservation {
  time: number
  event: "hover-target" | "hover-blocked" | "hover-no-content" | "request-started" | "stream-started" | "request-completed" | "request-failed" | "request-cancelled" | "layout-preview" | "layout-final"
  target?: string
  block?: string
  selector?: string | null
  reason?: string
  layout?: "block" | "inline" | "deferred-inline" | null
  sessionId?: string
  generation?: number
  targetDisplay?: string
  blockDisplay?: string
  root?: "document" | "shadow"
}

const observers = new Set<(event: SiteRulePreviewObservation) => void>()

export function describePreviewElement(element: Element): string {
  return `${element.localName}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 6).map(name => `.${name}`).join("")}`
}

export function observeSiteRulePreview(callback: (event: SiteRulePreviewObservation) => void): () => void {
  observers.add(callback)
  return () => observers.delete(callback)
}

export function recordSiteRulePreview(event: Omit<SiteRulePreviewObservation, "time">): void {
  if (!observers.size)
    return
  const observation = { ...getHostPreviewContext(), ...event, time: Date.now() }
  observers.forEach(observer => observer(observation))
}
