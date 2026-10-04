import type { SiteRuleDiagnostic, SiteRuleSession } from "./document"
import type { HostPreviewConfig } from "./preview-config"
import type { SiteRulePreviewObservation } from "./preview-observations"
import type { Config } from "@/types/config/config"
import { getLocalConfig } from "@/utils/config/storage"
import { isShallowInlineHTMLElement, isSiteRuleForceInlineNodeElement, isTranslatedWrapperNode, isWalkBlockedElement, isWithinIncludeScope } from "@/utils/host/dom/filter"
import { getTranslationGroup } from "@/utils/host/dom/translation-group"
import { extractTextContentFromNodes } from "@/utils/host/dom/traversal"
import { hasGroupOriginalNodes } from "@/utils/host/translate/dom/group-original-nodes"
import { hasOriginalNodes } from "@/utils/host/translate/dom/original-nodes"
import { shouldFilterSmallParagraph } from "@/utils/host/translate/filter-small-paragraph"
import { onMessage, sendMessage } from "@/utils/message"
import { documentMatchesPage } from "./document"
import { getEffectiveSiteRule } from "./effective"
import { getHostConfig } from "./preview-config"
import { observeSiteRulePreview } from "./preview-observations"

export interface SiteRulePreviewReport {
  session: SiteRuleSession | null
  status: "idle" | "restoring" | "previewing" | "paused" | "invalid" | "stopped" | "error"
  currentUrl: string
  diagnostics: {
    readableBodyCount: number
    matchedRuleIds?: string[]
    selectedStyle?: Config["translate"]["translationNodeStyle"]["preset"]
    translationMode?: Config["translate"]["mode"]
    issues: SiteRuleDiagnostic[]
  }
  observations: SiteRulePreviewObservation[]
}

export interface SiteRulePreviewController {
  getReport: () => SiteRulePreviewReport
  subscribe: (listener: (report: SiteRulePreviewReport) => void) => () => void
  reload: () => Promise<void>
  applySession: (session: SiteRuleSession | null) => Promise<void>
  dispose: () => void
}

export function createSiteRulePreviewController(options: {
  resetTranslation: (config: HostPreviewConfig | null, generation: number, isCurrent: () => boolean) => Promise<void>
}): SiteRulePreviewController {
  let stopped = false
  let generation = 0
  let queue = Promise.resolve()
  let appliedKey: string | null = null
  let appliedGeneration = 0
  let newestSession: SiteRuleSession | null = null
  let report: SiteRulePreviewReport = {
    session: null,
    status: "idle",
    currentUrl: window.location.href,
    diagnostics: { readableBodyCount: 0, issues: [] },
    observations: [],
  }
  const listeners = new Set<(report: SiteRulePreviewReport) => void>()
  const publish = (next: SiteRulePreviewReport) => {
    if (stopped)
      return
    report = next
    listeners.forEach(listener => listener(report))
  }
  const diagnostic = (code: SiteRuleDiagnostic["code"], message: string): SiteRuleDiagnostic => ({ code, path: "preview", message })
  const diagnose = async () => {
    const config = await getHostConfig()
    const issues: SiteRuleDiagnostic[] = []
    if (!config)
      return { readableBodyCount: 0, issues }
    const effective = getEffectiveSiteRule(config, window.location.href)
    let readableBodyCount = 0
    let visited = 0
    let truncated = false
    const deadline = performance.now() + 40
    // Read the current DOM only. No labels, snapshots or cached host markup.
    const visit = (element: HTMLElement, depth = 0): boolean => {
      if (++visited > 5000 || performance.now() > deadline || depth > 120) {
        truncated = true
        return false
      }
      // Translation-only results still represent a real matched source group;
      // refreshing the report must not mistake their hidden source for zero.
      if (isTranslatedWrapperNode(element) && (hasOriginalNodes(element) || hasGroupOriginalNodes(element))) {
        readableBodyCount++
        return true
      }
      if (isWalkBlockedElement(element, config))
        return false
      const group = getTranslationGroup(element, config)
      if (group) {
        const wrapper = group.placement === "append"
          ? [...element.children].find(child => child instanceof HTMLElement && hasGroupOriginalNodes(child))
          : element.nextElementSibling instanceof HTMLElement && hasGroupOriginalNodes(element.nextElementSibling)
        const text = extractTextContentFromNodes(group.sources, config, { preserveBlockBoundaries: true }).trim()
        if (wrapper || (text && !shouldFilterSmallParagraph(text, config))) {
          readableBodyCount++
          return true
        }
        return false
      }
      let descendantBody = false
      for (const child of element.children) {
        if (visited >= 5000 || performance.now() > deadline) {
          truncated = true
          break
        }
        if (child instanceof HTMLElement)
          descendantBody = visit(child, depth + 1) || descendantBody
      }
      if (element.shadowRoot) {
        for (const child of element.shadowRoot.children) {
          if (visited >= 5000 || performance.now() > deadline) {
            truncated = true
            break
          }
          if (child instanceof HTMLElement)
            descendantBody = visit(child, depth + 1) || descendantBody
        }
      }
      if (performance.now() > deadline) {
        truncated = true
        return descendantBody
      }
      const hasText = [...element.childNodes].some(child => (child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
        || (child instanceof HTMLElement && performance.now() <= deadline && !isWalkBlockedElement(child, config)
          && (isSiteRuleForceInlineNodeElement(child, config) || isShallowInlineHTMLElement(child, undefined, config))))
      if (!descendantBody && hasText && isWithinIncludeScope(element, config)
        && !shouldFilterSmallParagraph(element.textContent ?? "", config)) {
        readableBodyCount++
        return true
      }
      return descendantBody
    }
    if (document.body)
      visit(document.body)
    if (truncated)
      issues.push(diagnostic("preview_failed", readableBodyCount ? "页面检查已达到上限，正文计数仅包含已检查部分；请继续手动确认帖子与交互。" : "页面检查已达到上限，尚不能确认是否命中正文；这不代表规则没有命中，请精简范围后重新试用。"))
    if (!readableBodyCount && !truncated)
      issues.push(diagnostic("no_matched_body", "No readable content matched the effective rules on this page."))
    if (!effective.matchedRuleIds.length)
      issues.push(diagnostic("scope_mismatch", "No site rule matched the current page URL."))
    if (config.features.hoverHotkey === "clickAndHold")
      issues.push(diagnostic("click_hold_unsupported", "Mouse hold on links and buttons is not supported; use a keyboard hover trigger."))
    return {
      readableBodyCount,
      matchedRuleIds: effective.matchedRuleIds,
      selectedStyle: config.translate.translationNodeStyle.preset,
      translationMode: config.translate.mode,
      issues,
    }
  }
  const apply = async (session: SiteRuleSession | null, token: number) => {
    if (stopped || token !== generation)
      return
    const currentUrl = window.location.href
    if (!session && appliedKey === null) {
      publish({ session, status: "idle", currentUrl, diagnostics: { readableBodyCount: 0, issues: [] }, observations: [] })
      return
    }
    const active = session?.status === "previewing"
      && session.previewRevision === session.revision && session.previewRules !== null
    const saved = await getLocalConfig()
    if (stopped || token !== generation)
      return
    const inScope = !!session && session.siteHosts.includes(window.location.hostname)
      && !!session.document && !!saved && documentMatchesPage(session.document, saved.siteRules, currentUrl)
    const key = active && inScope && session ? `${session.id}:${session.previewRevision}:${session.draftHash}:${currentUrl}:${JSON.stringify(session.previewRules)}` : null
    const changed = key !== appliedKey
    if (changed) {
      publish({ session, status: "restoring", currentUrl, diagnostics: { readableBodyCount: 0, issues: [] }, observations: [] })
      await options.resetTranslation(key && session
        ? {
            siteRules: session.previewRules!, sessionId: session.id, generation: token,
          }
        : null, token, () => !stopped && token === generation)
    }
    if (stopped || token !== generation)
      return
    appliedKey = key
    if (changed)
      appliedGeneration = token
    const diagnostics = key ? await diagnose() : { readableBodyCount: 0, issues: [...(session?.issues ?? [])] }
    if (stopped || token !== generation)
      return
    if (active && !inScope)
      diagnostics.issues.push(diagnostic("scope_mismatch", "Preview is paused because this page is outside the draft scope."))
    const status: SiteRulePreviewReport["status"] = active
      ? inScope ? diagnostics.readableBodyCount ? "previewing" : "error" : "paused"
      : session?.status === "invalid" ? "invalid" : session?.status === "stopped" ? "stopped" : "idle"
    publish({ session, status, currentUrl, diagnostics, observations: report.observations })
    if (key && session && diagnostics.readableBodyCount > 0 && !session.previewAcknowledged && session.draftHash) {
      try {
        const acknowledged = await sendMessage("ackSiteRulePreview", {
          revision: session.revision, draftHash: session.draftHash, readableBodyCount: diagnostics.readableBodyCount, url: currentUrl,
        })
        if (!stopped && token === generation) {
          newestSession = acknowledged.session
          publish(acknowledged.ok
            ? { ...report, session: acknowledged.session }
            : { ...report, session: acknowledged.session, status: "error", diagnostics: { ...diagnostics, issues: [...diagnostics.issues, ...acknowledged.issues] } })
        }
      }
      catch (error) {
        if (!stopped && token === generation)
          publish({ ...report, status: "error", diagnostics: { ...diagnostics, issues: [...diagnostics.issues, diagnostic("request_failed", error instanceof Error ? error.message : String(error))] } })
      }
    }
  }
  const schedule = (session: SiteRuleSession | null, token: number) => {
    queue = queue.catch(() => {}).then(() => apply(session, token)).catch((error) => {
      if (!stopped && token === generation)
        publish({ ...report, status: "error", diagnostics: { readableBodyCount: 0, issues: [diagnostic("preview_failed", error instanceof Error ? error.message : String(error))] } })
    })
    return queue
  }
  const applySession = (session: SiteRuleSession | null) => {
    if (session && newestSession && session.updatedAt < newestSession.updatedAt)
      return queue
    newestSession = session
    return schedule(session, ++generation)
  }
  const reload = async () => {
    const token = ++generation
    try {
      const result = await sendMessage("getSiteRuleSession", undefined)
      if (!stopped && token === generation) {
        if (!result.ok) {
          publish({ ...report, status: "error", diagnostics: { ...report.diagnostics, issues: result.issues } })
          return
        }
        newestSession = result.session
        await schedule(result.session, token)
      }
    }
    catch (error) {
      if (!stopped && token === generation)
        publish({ ...report, status: "error", diagnostics: { readableBodyCount: 0, issues: [diagnostic("request_failed", error instanceof Error ? error.message : String(error))] } })
    }
  }
  const unlisten = onMessage("siteRuleSessionChanged", message => applySession(message.data.session))
  const unobserve = observeSiteRulePreview((observation) => {
    if (report.session?.status === "previewing" && appliedKey && report.status !== "restoring"
      && observation.sessionId === report.session.id && observation.generation === appliedGeneration) {
      publish({ ...report, observations: [...report.observations.slice(-29), observation] })
    }
  })
  const routeChanged = () => {
    if (report.session)
      void reload()
    else
      publish({ ...report, currentUrl: window.location.href })
  }
  window.addEventListener("extension:URLChange", routeChanged)
  return {
    getReport: () => report,
    subscribe(listener) {
      listeners.add(listener)
      listener(report)
      return () => listeners.delete(listener)
    },
    reload,
    applySession,
    dispose() {
      stopped = true
      generation++
      unlisten()
      unobserve()
      window.removeEventListener("extension:URLChange", routeChanged)
      listeners.clear()
    },
  }
}
