import type { Config } from "@/types/config/config"
import type { SiteRuleDiagnostic, SiteRuleSession, SiteRuleSessionResult, SiteRuleUndoEntry } from "@/utils/site-rules/document"
import { browser, storage } from "#imports"
import { configSchema } from "@/types/config/config"
import { subtitleStyleSchema } from "@/types/config/subtitle-style"
import { getLocalConfigForWrite } from "@/utils/config/storage"
import { withConfigWriteLock } from "@/utils/config/write-lock"
import { EXTENSION_VERSION } from "@/utils/constants/app"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { sha256Hex } from "@/utils/hash"
import { onMessage, sendMessage } from "@/utils/message"
import {
  canonicalSiteRuleValue,
  documentMatchesPage,
  getSiteRuleSelectorEntries,
  isSiteRuleDocumentForUrl,
  mergeSiteRuleDocument,
  parseSiteRuleDocument,
  siteRuleBaseFingerprint,
  siteRuleHost,
  siteRuleIssue,
  stringifySiteRuleDocument,
  undoSiteRuleEntries,
} from "@/utils/site-rules/document"

const SESSION_PREFIX = "readomi-site-rule-session:"

interface SavedTransaction {
  revision: number
  entries: SiteRuleUndoEntry[]
}

interface StoredSession {
  version: string
  session: SiteRuleSession
  undo: SavedTransaction | null
  pendingSave?: SavedTransaction
  pendingUndo?: boolean
  previewUrl?: string
  previewDocumentId?: string
}

const sessions = new Map<number, StoredSession>()
const queues = new Map<number, Promise<unknown>>()

function serializeTab<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  const task = (queues.get(tabId) ?? Promise.resolve()).then(operation)
  const tail = task.catch(() => {})
  queues.set(tabId, tail)
  void tail.finally(() => {
    if (queues.get(tabId) === tail)
      queues.delete(tabId)
  })
  return task
}

function success(session: SiteRuleSession | null): SiteRuleSessionResult {
  return { ok: true, session }
}

function failure(session: SiteRuleSession | null, issues: SiteRuleDiagnostic[]): SiteRuleSessionResult {
  return { ok: false, session, issues }
}

function clearPreview(session: SiteRuleSession): void {
  session.previewRevision = null
  session.previewAcknowledged = false
  session.previewHash = null
  session.previewRules = null
  session.baseFingerprint = null
}

async function persist(tabId: number, stored: StoredSession, notify = true): Promise<void> {
  stored.session.updatedAt = Date.now()
  await browser.storage.session.set({ [`${SESSION_PREFIX}${tabId}`]: stored })
  sessions.set(tabId, stored)
  // Do not await a content receiver that may itself ask for the session.
  if (notify)
    void sendMessage("siteRuleSessionChanged", { session: stored.session }, tabId).catch(() => {})
}

function entriesEqual(config: Config, entries: SiteRuleUndoEntry[], side: "before" | "after"): boolean {
  return entries.every(entry => canonicalSiteRuleValue(config.siteRules.userRules.find(rule => rule.id === entry.id) ?? null)
    === canonicalSiteRuleValue(entry[side]))
}

/** A prepared record lets a restarted worker recover a completed local write. */
async function readSession(tabId: number): Promise<StoredSession | null> {
  let stored = sessions.get(tabId)
  if (!stored) {
    const values = await browser.storage.session.get(`${SESSION_PREFIX}${tabId}`)
    stored = values[`${SESSION_PREFIX}${tabId}`] as StoredSession | undefined
    if (!stored?.session || stored.session.tabId !== tabId)
      return null
    sessions.set(tabId, stored)
  }
  let changed = false
  if (stored.pendingSave || stored.pendingUndo) {
    const config = await getLocalConfigForWrite()
    if (stored.pendingSave) {
      if (entriesEqual(config, stored.pendingSave.entries, "after")) {
        stored.undo = stored.pendingSave
        stored.session.status = "saved"
        stored.session.savedRevision = stored.pendingSave.revision
        stored.session.undoAvailable = true
        clearPreview(stored.session)
      }
      else if (!entriesEqual(config, stored.pendingSave.entries, "before")) {
        stored.session.status = "conflict"
        stored.session.issues = [siteRuleIssue("conflict", "changes", "保存期间相关规则发生变化，请重新比较当前规则。")]
        clearPreview(stored.session)
      }
      delete stored.pendingSave
    }
    if (stored.pendingUndo) {
      if (stored.undo && entriesEqual(config, stored.undo.entries, "before")) {
        stored.undo = null
        stored.session.undoAvailable = false
        stored.session.status = "stopped"
        stored.session.savedRevision = null
        clearPreview(stored.session)
      }
      delete stored.pendingUndo
    }
    changed = true
  }
  if (stored.version !== EXTENSION_VERSION) {
    stored.version = EXTENSION_VERSION
    clearPreview(stored.session)
    if (stored.session.status === "previewing")
      stored.session.status = "stopped"
    changed = true
  }
  if (changed)
    await persist(tabId, stored)
  // A failed storage write must not mutate the previously committed in-memory session.
  return structuredClone(stored)
}

function newSession(tabId: number, url: string): StoredSession {
  return {
    version: EXTENSION_VERSION,
    undo: null,
    session: {
      id: getRandomUUID(), tabId, url, siteHosts: [siteRuleHost(url)!], revision: 0, text: "", document: null,
      issues: [], status: "draft", draftHash: null, previewHash: null, previewRevision: null, previewAcknowledged: false,
      previewRules: null, baseFingerprint: null, savedRevision: null, undoAvailable: false, updatedAt: Date.now(),
    },
  }
}

async function currentUrl(tabId: number): Promise<string | null> {
  try {
    const tab = await browser.tabs.get(tabId)
    const url = tab.url ?? ""
    return siteRuleHost(url) ? url : null
  }
  catch {
    return null
  }
}

async function validateNativeSelectors(tabId: number, stored: StoredSession): Promise<SiteRuleDiagnostic[]> {
  const selectors: { path: string, selector: string }[] = []
  stored.session.document!.changes.forEach((change, index) => {
    if (change.action !== "upsert")
      return
    selectors.push(...getSiteRuleSelectorEntries(change.rule, `changes.${index}.rule`))
  })
  if (!selectors.length)
    return []
  const results = await browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (items: { path: string, selector: string }[]) => {
      const invalid: string[] = []
      const fragment = document.createDocumentFragment()
      for (const item of items) {
        try {
          fragment.querySelector(item.selector)
        }
        catch {
          invalid.push(item.path)
        }
      }
      return invalid
    },
    args: [selectors],
  })
  if (!results.length || !Array.isArray(results[0]?.result))
    return [siteRuleIssue("preview_failed", "changes", "当前页面未能完成选择器检查，请返回网站后重新预览。")]
  return results.flatMap(result => (result.result ?? []).map(path => siteRuleIssue("invalid_selector", path, "CSS 选择器无效，当前稿未应用。")))
}

async function getCurrent(tabId: number): Promise<SiteRuleSessionResult> {
  const stored = await readSession(tabId)
  if (!stored)
    return success(null)
  const url = await currentUrl(tabId)
  if (url) {
    stored.session.url = url
    if (stored.previewUrl && stored.previewUrl !== url)
      stored.session.previewAcknowledged = false
  }
  if (stored.session.status === "previewing" && stored.session.document) {
    const config = await getLocalConfigForWrite()
    const fingerprint = await siteRuleBaseFingerprint(config, stored.session.document)
    if (fingerprint !== stored.session.baseFingerprint) {
      clearPreview(stored.session)
      stored.session.status = "conflict"
      stored.session.issues = [siteRuleIssue("conflict", "changes", "该网站规则或阅读设置已变化，请重新预览当前稿。")]
    }
    else {
      const merged = mergeSiteRuleDocument(config.siteRules, stored.session.document)
      if (merged.ok)
        stored.session.previewRules = merged.siteRules
    }
    await persist(tabId, stored, false)
  }
  return success(stored.session)
}

async function setDraft(tabId: number, text: string): Promise<SiteRuleSessionResult> {
  const url = await currentUrl(tabId)
  if (!url)
    return failure(null, [siteRuleIssue("tab_unavailable", "site", "请在可访问的网站标签页中提交规则文档。")])
  const stored = await readSession(tabId) ?? newSession(tabId, url)
  const parsed = parseSiteRuleDocument(text, url)
  const canonicalText = parsed.ok ? stringifySiteRuleDocument(parsed.document) : text
  const hash = parsed.ok ? await sha256Hex(canonicalSiteRuleValue(parsed.document)) : null
  if (hash !== null && hash === stored.session.draftHash)
    return success(stored.session)
  clearPreview(stored.session)
  stored.session.revision++
  stored.session.url = url
  stored.session.text = canonicalText
  stored.session.document = parsed.ok ? parsed.document : null
  stored.session.siteHosts = parsed.ok ? parsed.document.site.hosts : [siteRuleHost(url)!]
  stored.session.draftHash = hash
  stored.session.issues = parsed.ok ? [] : parsed.issues
  stored.session.status = parsed.ok ? "draft" : "invalid"
  await persist(tabId, stored)
  return parsed.ok ? success(stored.session) : failure(stored.session, parsed.issues)
}

async function preview(tabId: number, revision: number): Promise<SiteRuleSessionResult> {
  const stored = await readSession(tabId)
  if (!stored?.session.document)
    return failure(stored?.session ?? null, [siteRuleIssue("no_session", "document", "请先粘贴有效的规则文档。")])
  if (revision !== stored.session.revision)
    return failure(stored.session, [siteRuleIssue("stale_revision", "revision", "规则已更新，请预览当前稿。")])
  const url = await currentUrl(tabId)
  if (!url || !isSiteRuleDocumentForUrl(stored.session.document, url))
    return failure(stored.session, [siteRuleIssue("scope_mismatch", "site.hosts", "请返回规则对应的网站后再预览。")])
  let nativeIssues: SiteRuleDiagnostic[]
  try {
    nativeIssues = await validateNativeSelectors(tabId, stored)
  }
  catch {
    return failure(stored.session, [siteRuleIssue("preview_failed", "site", "当前页面无法检查选择器，请返回可访问的网站后重新预览。")])
  }
  if (nativeIssues.length) {
    clearPreview(stored.session)
    stored.session.status = "invalid"
    stored.session.issues = nativeIssues
    await persist(tabId, stored)
    return failure(stored.session, nativeIssues)
  }
  return withConfigWriteLock(async () => {
    const config = await getLocalConfigForWrite()
    const merged = mergeSiteRuleDocument(config.siteRules, stored.session.document!)
    if (!merged.ok)
      return failure(stored.session, merged.issues)
    if (!documentMatchesPage(stored.session.document!, config.siteRules, url))
      return failure(stored.session, [siteRuleIssue("no_matched_body", "changes", "当前页面未匹配文档中的规则，请打开适用页面后预览。")])
    stored.session.url = url
    stored.session.baseFingerprint = await siteRuleBaseFingerprint(config, stored.session.document!)
    stored.session.previewRules = merged.siteRules
    stored.session.previewRevision = revision
    stored.session.previewAcknowledged = false
    delete stored.previewUrl
    delete stored.previewDocumentId
    stored.session.previewHash = stored.session.draftHash
    stored.session.status = "previewing"
    stored.session.issues = []
    await persist(tabId, stored)
    return success(stored.session)
  })
}

async function acknowledge(tabId: number, data: { revision: number, draftHash: string, readableBodyCount: number, url: string }, documentId?: string): Promise<SiteRuleSessionResult> {
  const stored = await readSession(tabId)
  if (!stored?.session.document || stored.session.status !== "previewing")
    return failure(stored?.session ?? null, [siteRuleIssue("not_previewed", "revision", "当前稿没有正在运行的预览。")])
  if (data.revision !== stored.session.revision || data.revision !== stored.session.previewRevision || data.draftHash !== stored.session.draftHash)
    return failure(stored.session, [siteRuleIssue("stale_revision", "revision", "预览结果来自旧稿，请应用当前稿。")])
  const url = await currentUrl(tabId)
  if (!url || data.url !== url || !isSiteRuleDocumentForUrl(stored.session.document, url))
    return failure(stored.session, [siteRuleIssue("scope_mismatch", "site", "页面已变化，请在当前适用页面重新预览。")])
  if (!Number.isFinite(data.readableBodyCount) || data.readableBodyCount <= 0)
    return failure(stored.session, [siteRuleIssue("no_matched_body", "changes", "当前页面未匹配可翻译正文，请继续调整规则。")])
  const config = await getLocalConfigForWrite()
  if (await siteRuleBaseFingerprint(config, stored.session.document) !== stored.session.baseFingerprint)
    return failure(stored.session, [siteRuleIssue("conflict", "changes", "相关配置已变化，请重新预览。")])
  stored.session.previewAcknowledged = true
  stored.previewUrl = url
  stored.previewDocumentId = documentId
  await persist(tabId, stored, false)
  return success(stored.session)
}

async function save(tabId: number, revision: number, documentId?: string): Promise<SiteRuleSessionResult> {
  const stored = await readSession(tabId)
  if (!stored?.session.document)
    return failure(stored?.session ?? null, [siteRuleIssue("no_session", "document", "没有可保存的规则文档。")])
  if (revision !== stored.session.revision)
    return failure(stored.session, [siteRuleIssue("stale_revision", "revision", "规则已换稿，请保存当前预览的版本。")])
  if (stored.session.status === "saved" && stored.session.savedRevision === revision)
    return success(stored.session)
  if (stored.session.status !== "previewing" || stored.session.previewRevision !== revision
    || stored.session.previewHash !== stored.session.draftHash || !stored.session.previewAcknowledged) {
    return failure(stored.session, [siteRuleIssue("not_previewed", "revision", "请先成功预览这一稿，再保存规则。")])
  }
  const url = await currentUrl(tabId)
  if (!url || !isSiteRuleDocumentForUrl(stored.session.document, url))
    return failure(stored.session, [siteRuleIssue("scope_mismatch", "site.hosts", "目标网站已离开或关闭，请返回后保存当前稿。")])
  if (stored.previewUrl !== url || (stored.previewDocumentId && documentId && stored.previewDocumentId !== documentId))
    return failure(stored.session, [siteRuleIssue("not_previewed", "revision", "当前页面尚未完成同稿预览，请重新预览后保存。")])
  return withConfigWriteLock(async () => {
    const config = await getLocalConfigForWrite()
    if (await siteRuleBaseFingerprint(config, stored.session.document!) !== stored.session.baseFingerprint) {
      stored.session.status = "conflict"
      clearPreview(stored.session)
      stored.session.issues = [siteRuleIssue("conflict", "changes", "该网站规则或阅读设置已变化，请重新预览后保存。")]
      await persist(tabId, stored)
      return failure(stored.session, stored.session.issues)
    }
    const merged = mergeSiteRuleDocument(config.siteRules, stored.session.document!)
    if (!merged.ok)
      return failure(stored.session, merged.issues)
    const transaction = { revision, entries: merged.changes }
    stored.pendingSave = transaction
    await persist(tabId, stored, false)
    try {
      await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, configSchema.parse({ ...config, siteRules: merged.siteRules }))
    }
    catch (error) {
      delete stored.pendingSave
      await persist(tabId, stored, false).catch(() => {})
      throw error
    }
    stored.undo = transaction
    stored.session.status = "saved"
    stored.session.savedRevision = revision
    stored.session.undoAvailable = true
    stored.session.issues = []
    clearPreview(stored.session)
    // If this metadata write fails, the prepared session recovers the successful local write.
    delete stored.pendingSave
    await persist(tabId, stored).catch(() => {
      sessions.set(tabId, stored)
      void sendMessage("siteRuleSessionChanged", { session: stored.session }, tabId).catch(() => {})
    })
    return success(stored.session)
  })
}

async function stop(tabId: number): Promise<SiteRuleSessionResult> {
  const stored = await readSession(tabId)
  if (!stored)
    return success(null)
  clearPreview(stored.session)
  if (stored.session.status !== "saved")
    stored.session.status = "stopped"
  stored.session.issues = []
  await persist(tabId, stored)
  return success(stored.session)
}

async function undo(tabId: number): Promise<SiteRuleSessionResult> {
  const stored = await readSession(tabId)
  if (!stored?.undo)
    return failure(stored?.session ?? null, [siteRuleIssue("no_session", "changes", "没有可撤销的保存记录。")])
  return withConfigWriteLock(async () => {
    const config = await getLocalConfigForWrite()
    const result = undoSiteRuleEntries(config.siteRules, stored.undo!.entries)
    if (!result.ok)
      return failure(stored.session, result.issues)
    stored.pendingUndo = true
    await persist(tabId, stored, false)
    try {
      await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, configSchema.parse({ ...config, siteRules: result.siteRules }))
    }
    catch (error) {
      delete stored.pendingUndo
      await persist(tabId, stored, false).catch(() => {})
      throw error
    }
    stored.session.undoAvailable = false
    stored.session.savedRevision = null
    stored.session.status = "stopped"
    stored.session.issues = []
    clearPreview(stored.session)
    stored.undo = null
    delete stored.pendingUndo
    await persist(tabId, stored).catch(() => {
      sessions.set(tabId, stored)
      void sendMessage("siteRuleSessionChanged", { session: stored.session }, tabId).catch(() => {})
    })
    return success(stored.session)
  })
}

async function run(tabId: number | undefined, operation: (id: number) => Promise<SiteRuleSessionResult>): Promise<SiteRuleSessionResult> {
  if (typeof tabId !== "number")
    return failure(null, [siteRuleIssue("tab_unavailable", "site", "请从目标网站的预览面板操作规则。")])
  return serializeTab(tabId, async () => {
    try {
      return await operation(tabId)
    }
    catch {
      return failure(sessions.get(tabId)?.session ?? null, [siteRuleIssue("storage_failed", "session", "操作未完成，请保留规则文档后重试。")])
    }
  })
}

export function setupSiteRuleSessions(): void {
  onMessage("getSiteRuleSession", message => run(message.sender?.tab?.id, getCurrent))
  const mutationTab = (sender: { tab?: { id?: number }, frameId?: number } | undefined) => sender?.frameId && sender.frameId !== 0 ? undefined : sender?.tab?.id
  onMessage("setSiteRuleDraft", message => run(mutationTab(message.sender), tabId => setDraft(tabId, message.data.text)))
  onMessage("previewSiteRuleDraft", message => run(mutationTab(message.sender), tabId => preview(tabId, message.data.revision)))
  onMessage("ackSiteRulePreview", message => run(mutationTab(message.sender), tabId => acknowledge(tabId, message.data, (message.sender as { documentId?: string } | undefined)?.documentId)))
  onMessage("saveSiteRuleDraft", message => run(mutationTab(message.sender), tabId => save(tabId, message.data.revision, (message.sender as { documentId?: string } | undefined)?.documentId)))
  onMessage("stopSiteRulePreview", message => run(mutationTab(message.sender), stop))
  onMessage("undoSiteRuleSave", message => run(mutationTab(message.sender), undo))
  onMessage("saveSubtitleStylePatch", async (message) => {
    await withConfigWriteLock(async () => {
      const config = await getLocalConfigForWrite()
      const parsed = subtitleStyleSchema.safeParse({ ...config.features.subtitleStyle, ...message.data.patch })
      if (!parsed.success)
        throw new Error("字幕样式参数无效，配置未保存。")
      await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, configSchema.parse({ ...config, features: { ...config.features, subtitleStyle: parsed.data } }))
    })
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    void serializeTab(tabId, async () => {
      sessions.delete(tabId)
      await browser.storage.session.remove(`${SESSION_PREFIX}${tabId}`)
    }).catch(() => {})
  })
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url && change.status !== "loading")
      return
    void run(tabId, async (id) => {
      const stored = await readSession(id)
      if (stored) {
        if (change.url)
          stored.session.url = change.url
        stored.session.previewAcknowledged = false
        delete stored.previewUrl
        delete stored.previewDocumentId
        await persist(id, stored)
      }
      return success(stored?.session ?? null)
    })
  })
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[CONFIG_STORAGE_KEY])
      return
    void browser.storage.session.get(null).then((values) => {
      for (const key of Object.keys(values)) {
        if (!key.startsWith(SESSION_PREFIX))
          continue
        const tabId = Number(key.slice(SESSION_PREFIX.length))
        if (!Number.isSafeInteger(tabId))
          continue
        void run(tabId, async (id) => {
          const result = await getCurrent(id)
          if (result.session)
            void sendMessage("siteRuleSessionChanged", { session: result.session }, id).catch(() => {})
          return result
        })
      }
    }).catch(() => {})
  })
}
