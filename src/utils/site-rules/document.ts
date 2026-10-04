import type { Config } from "@/types/config/config"
import type { SiteRule, SiteRulesConfig } from "@/types/config/site-rules"
import { z } from "zod"
import { MAX_SITE_RULES_JSON_LENGTH, MAX_USER_SITE_RULES, siteRuleSchema, translationGroupSchema } from "@/types/config/site-rules"
import { EXTENSION_VERSION } from "@/utils/constants/app"
import { sha256Hex } from "@/utils/hash"
import { normalizeBuiltInSiteRuleId, normalizeDisabledBuiltInRuleIds } from "./branding"
import { BUILT_IN_SITE_RULES, READOMI_SITE_RULES } from "./built-in"
import { sanitizeSiteRuleCss } from "./css"
import { getEffectiveSiteRule } from "./effective"
import { urlMatchesRule } from "./resolve"
import { normalizeUrlPattern, urlMatchesPattern } from "./url-pattern"

export type SiteRuleDiagnosticCode
  = | "syntax" | "schema" | "version" | "too_long" | "too_many" | "duplicate_id"
    | "invalid_host" | "invalid_pattern" | "scope_mismatch" | "invalid_selector"
    | "unsafe_css" | "protected_tag" | "missing_rule" | "builtin_id" | "conflict"
    | "stale_revision" | "not_previewed" | "no_session" | "tab_unavailable"
    | "storage_failed" | "no_matched_body" | "click_hold_unsupported"
    | "preview_failed" | "request_failed"

export interface SiteRuleDiagnostic {
  code: SiteRuleDiagnosticCode
  path: string
  message: string
}

export type SiteRuleIssue = SiteRuleDiagnostic

const documentSchema = z.strictObject({
  format: z.literal("readomi-site-rule"),
  version: z.literal(1),
  site: z.strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    hosts: z.array(z.string().trim().min(1).max(253)).min(1).max(20),
  }),
  changes: z.array(z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("upsert"), rule: siteRuleSchema.strict().extend({
      translationGroups: z.array(translationGroupSchema.strict()).optional(),
    }) }),
    z.strictObject({ action: z.literal("disable"), id: z.string().trim().min(1).max(128) }),
  ])).min(1).max(MAX_USER_SITE_RULES),
})

export type SiteRuleDocument = z.infer<typeof documentSchema>
export type SiteRuleDocumentChange = SiteRuleDocument["changes"][number]

export interface SiteRuleUndoEntry {
  id: string
  before: SiteRule | null
  after: SiteRule
  index: number
}

export interface SiteRuleSession {
  id: string
  tabId: number
  url: string
  siteHosts: string[]
  revision: number
  text: string
  document: SiteRuleDocument | null
  issues: SiteRuleDiagnostic[]
  status: "draft" | "invalid" | "previewing" | "saved" | "stopped" | "conflict"
  draftHash: string | null
  previewHash: string | null
  previewRevision: number | null
  previewAcknowledged: boolean
  previewRules: SiteRulesConfig | null
  baseFingerprint: string | null
  savedRevision: number | null
  undoAvailable: boolean
  updatedAt: number
}

export type SiteRuleSessionResult
  = | { ok: true, session: SiteRuleSession | null }
    | { ok: false, issues: SiteRuleDiagnostic[], session: SiteRuleSession | null }

export type SiteRuleDocumentResult
  = | { ok: true, document: SiteRuleDocument }
    | { ok: false, issues: SiteRuleDiagnostic[] }

export type SiteRuleMergeResult
  = | { ok: true, siteRules: SiteRulesConfig, changes: SiteRuleUndoEntry[] }
    | { ok: false, issues: SiteRuleDiagnostic[] }

const builtInIds = new Set([...BUILT_IN_SITE_RULES, ...READOMI_SITE_RULES].map(rule => rule.id))
const protectedTags = new Set(["HEAD", "TITLE", "META", "SCRIPT", "NOSCRIPT", "STYLE", "LINK"])

export function siteRuleIssue(code: SiteRuleDiagnosticCode, path: string, message: string): SiteRuleDiagnostic {
  return { code, path, message }
}

export function siteRuleHost(url: string): string | null {
  try {
    const parsed = new URL(url)
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null
  }
  catch {
    return null
  }
}

export function isSiteRuleDocumentForUrl(document: SiteRuleDocument, url: string): boolean {
  const host = siteRuleHost(url)
  return host !== null && document.site.hosts.includes(host)
}

function patternHost(pattern: string): string | null {
  return normalizeUrlPattern(pattern)?.match(/^[a-z*]+:\/\/([^/]+)\//)?.[1] ?? null
}

function validHost(host: string): boolean {
  if (!/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/.test(host) || host.includes(".."))
    return false
  try {
    return new URL(`https://${host}/`).hostname === host
      && host.split(".").every(label => label.length <= 63 && !label.startsWith("-") && !label.endsWith("-"))
  }
  catch {
    return false
  }
}

/** Stable objects, ordered arrays: rule order is part of the execution contract. */
export function canonicalSiteRuleValue(value: unknown): string {
  const canonicalize = (current: unknown): unknown => {
    if (Array.isArray(current))
      return current.map(canonicalize)
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(Object.entries(current).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, canonicalize(entry)]))
    }
    return current
  }
  return JSON.stringify(canonicalize(value)) ?? "null"
}

export function stringifySiteRuleDocument(document: SiteRuleDocument): string {
  return JSON.stringify(document, null, 2)
}

/** Shared by document parsing and the worker's native selector validation. */
export function getSiteRuleSelectorEntries(rule: SiteRule, path: string): { path: string, selector: string }[] {
  const entries: { path: string, selector: string }[] = []
  for (const [key, values] of Object.entries(rule)) {
    if (key.toLowerCase().includes("selectors") && Array.isArray(values)) {
      for (const [position, selector] of values.entries()) {
        if (typeof selector === "string")
          entries.push({ path: `${path}.${key}.${position}`, selector })
      }
    }
  }
  rule.translationGroups?.forEach((group, index) => {
    entries.push({ path: `${path}.translationGroups.${index}.containerSelector`, selector: group.containerSelector })
    group.sourceSelectors.forEach((selector, position) => {
      entries.push({ path: `${path}.translationGroups.${index}.sourceSelectors.${position}`, selector })
    })
  })
  return entries
}

/** Structural checks also run in the worker; native selector checks run when a DOM exists. */
export function parseSiteRuleDocument(text: string, url?: string): SiteRuleDocumentResult {
  if (typeof text !== "string" || text.length > MAX_SITE_RULES_JSON_LENGTH)
    return { ok: false, issues: [siteRuleIssue("too_long", "document", "规则文档不能超过 65,536 个字符。")] }
  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  }
  catch {
    return { ok: false, issues: [siteRuleIssue("syntax", "document", "规则文档不是有效的 JSON。")] }
  }
  if (candidate !== null && typeof candidate === "object" && "version" in candidate && candidate.version !== 1)
    return { ok: false, issues: [siteRuleIssue("version", "version", "此规则文档版本暂不支持，请使用版本 1。")] }
  const result = documentSchema.safeParse(candidate)
  if (!result.success) {
    return { ok: false, issues: result.error.issues.map(issue => siteRuleIssue("schema", issue.path.join(".") || "document",
      issue.code === "unrecognized_keys" ? "包含不支持的字段，请移除后重新提交。" : "字段格式不正确，请按照规则文档格式修改。")) }
  }
  const document = result.data
  document.site.hosts = [...new Set(document.site.hosts.map(host => host.toLowerCase()))].sort()
  const issues: SiteRuleDiagnostic[] = []
  document.site.hosts.forEach((host, index) => {
    if (!validHost(host))
      issues.push(siteRuleIssue("invalid_host", `site.hosts.${index}`, "请填写精确主机名，不包含协议、端口、路径或通配符。"))
  })
  if (url && !isSiteRuleDocumentForUrl(document, url))
    issues.push(siteRuleIssue("scope_mismatch", "site.hosts", "规则文档的网站与当前标签页不符。"))
  const ids = new Set<string>()
  document.changes.forEach((change, index) => {
    const path = `changes.${index}`
    const id = change.action === "upsert" ? change.rule.id.trim() : change.id
    if (change.action === "upsert")
      change.rule.id = id
    if (!id || id.length > 128)
      issues.push(siteRuleIssue("schema", `${path}.id`, "规则 ID 应为 1 至 128 个字符。"))
    if (ids.has(id))
      issues.push(siteRuleIssue("duplicate_id", `${path}.id`, "同一份文档不能多次修改相同 ID。"))
    ids.add(id)
    if (builtInIds.has(normalizeBuiltInSiteRuleId(id)))
      issues.push(siteRuleIssue("builtin_id", `${path}.id`, "请为用户规则使用独立 ID，不能覆盖或暂停内置规则 ID。"))
    if (change.action === "disable")
      return
    const rule = change.rule
    const matches = typeof rule.matches === "string" ? [rule.matches] : rule.matches
    if (!matches.length)
      issues.push(siteRuleIssue("invalid_pattern", `${path}.rule.matches`, "至少填写一个适用网址模式。"))
    for (const key of ["matches", "excludeMatches"] as const) {
      const patterns = key === "matches" ? matches : rule.excludeMatches ?? []
      patterns.forEach((pattern, position) => {
        const normalized = normalizeUrlPattern(pattern)
        const host = patternHost(pattern)
        if (!normalized || !host)
          issues.push(siteRuleIssue("invalid_pattern", `${path}.rule.${key}.${position}`, "网址模式无效。"))
        else if (!document.site.hosts.includes(host))
          issues.push(siteRuleIssue("scope_mismatch", `${path}.rule.${key}.${position}`, "网址模式只能使用 site.hosts 中的精确主机名。"))
      })
    }
    for (const entry of getSiteRuleSelectorEntries(rule, `${path}.rule`)) {
      let valid = !!entry.selector.trim()
      if (valid && typeof globalThis.document !== "undefined") {
        try {
          globalThis.document.createDocumentFragment().querySelector(entry.selector)
        }
        catch {
          valid = false
        }
      }
      if (!valid)
        issues.push(siteRuleIssue("invalid_selector", entry.path, "CSS 选择器无效。"))
    }
    rule.translationGroups?.forEach((group, position) => {
      const slotPath = `${path}.rule.translationGroups.${position}.slot`
      if (group.slot !== undefined && !group.slot.trim())
        issues.push(siteRuleIssue("schema", slotPath, "插入槽位名称不能为空。"))
      if (group.slot !== undefined && group.placement === "after")
        issues.push(siteRuleIssue("schema", slotPath, "slot 只能与 append 位置一起使用，请移除槽位或改为 append。"))
    })
    for (const [key, values] of Object.entries(rule)) {
      if (key.endsWith("Tags.add") || key.endsWith("Tags.remove")) {
        (values as string[]).forEach((tag, position) => {
          if (!/^[a-z][a-z\d-]*$/i.test(tag))
            issues.push(siteRuleIssue("schema", `${path}.rule.${key}.${position}`, "请填写标签名称，不能填写 CSS 选择器。"))
          if (key === "dontWalkTags.remove" && protectedTags.has(tag.toUpperCase()))
            issues.push(siteRuleIssue("protected_tag", `${path}.rule.${key}.${position}`, "不能解除页面元数据、脚本或样式标签的过滤。"))
        })
      }
    }
    const css = [rule.injectedCss, ...(rule["injectedCss.add"] ?? [])]
    css.forEach((fragment, position) => {
      if (fragment?.trim() && sanitizeSiteRuleCss(fragment) === null)
        issues.push(siteRuleIssue("unsafe_css", `${path}.rule.injectedCss.${position}`, "CSS 包含不支持的资源加载、执行声明或超过长度限制。"))
    })
  })
  return issues.length ? { ok: false, issues } : { ok: true, document }
}

/** Host-only overlap includes path-specific and global existing rules in conflict detection. */
export function siteRuleTouchesHosts(rule: SiteRule, hosts: string[]): boolean {
  const patterns = typeof rule.matches === "string" ? [rule.matches] : rule.matches
  return patterns.some((pattern) => {
    const host = patternHost(pattern)
    return host !== null && hosts.some(site => urlMatchesPattern(`https://${site}/`, `*://${host}/*`))
  })
}

export function mergeSiteRuleDocument(config: SiteRulesConfig, document: SiteRuleDocument): SiteRuleMergeResult {
  const rules = [...config.userRules]
  const changes: SiteRuleUndoEntry[] = []
  const issues: SiteRuleDiagnostic[] = []
  if (new Set(rules.map(rule => rule.id)).size !== rules.length)
    return { ok: false, issues: [siteRuleIssue("duplicate_id", "siteRules.userRules", "已保存规则中有重复 ID，请先在设置中整理。")] }
  document.changes.forEach((change, position) => {
    const id = change.action === "upsert" ? change.rule.id : change.id
    const index = rules.findIndex(rule => rule.id === id)
    const before = index < 0 ? null : rules[index]!
    if (change.action === "disable" && !before) {
      issues.push(siteRuleIssue("missing_rule", `changes.${position}.id`, "要暂停的用户规则不存在。"))
      return
    }
    const oldPatterns = before ? typeof before.matches === "string" ? [before.matches] : before.matches : []
    if (before && (!oldPatterns.length || oldPatterns.some(pattern => !document.site.hosts.includes(patternHost(pattern) ?? "")))) {
      issues.push(siteRuleIssue("scope_mismatch", `changes.${position}.id`, "同 ID 的用户规则还影响其他网站，请使用独立 ID。"))
      return
    }
    const after: SiteRule = change.action === "upsert" ? change.rule : { ...before!, enabled: false }
    const targetIndex = index < 0 ? rules.length : index
    changes.push({ id, before, after, index: targetIndex })
    if (index < 0)
      rules.push(after)
    else
      rules[index] = after
  })
  if (rules.length > MAX_USER_SITE_RULES)
    issues.push(siteRuleIssue("too_many", "changes", "合并后用户规则不能超过 200 条。"))
  if (JSON.stringify(rules).length > MAX_SITE_RULES_JSON_LENGTH)
    issues.push(siteRuleIssue("too_long", "changes", "合并后用户规则超过长度限制，请精简后再保存。"))
  return issues.length ? { ok: false, issues } : { ok: true, siteRules: { ...config, userRules: rules }, changes }
}

export function undoSiteRuleEntries(config: SiteRulesConfig, entries: SiteRuleUndoEntry[]): SiteRuleMergeResult {
  const rules = [...config.userRules]
  for (const entry of entries) {
    const current = rules.find(rule => rule.id === entry.id)
    if (!current || canonicalSiteRuleValue(current) !== canonicalSiteRuleValue(entry.after))
      return { ok: false, issues: [siteRuleIssue("conflict", entry.id, "这条规则在保存后已被修改，不能直接撤销覆盖。")] }
  }
  for (const entry of entries) {
    const index = rules.findIndex(rule => rule.id === entry.id)
    if (entry.before)
      rules[index] = entry.before
    else
      rules.splice(index, 1)
  }
  return { ok: true, siteRules: { ...config, userRules: rules }, changes: [] }
}

/** Only affected sites and translation behavior bind a draft; unrelated settings remain writable. */
export async function siteRuleBaseFingerprint(config: Config, document: SiteRuleDocument): Promise<string> {
  const touchedIds = new Set(document.changes.map(change => change.action === "upsert" ? change.rule.id : change.id))
  const relatedBuiltIns = new Set(BUILT_IN_SITE_RULES.filter(rule => siteRuleTouchesHosts(rule, document.site.hosts)).map(rule => rule.id))
  const activeProvider = config.providersConfig.find(provider => provider.id === config.translate.providerId)
  return sha256Hex(canonicalSiteRuleValue({
    version: EXTENSION_VERSION,
    rules: config.siteRules.userRules.filter(rule => touchedIds.has(rule.id) || siteRuleTouchesHosts(rule, document.site.hosts)),
    disabled: normalizeDisabledBuiltInRuleIds(config.siteRules.disabledBuiltInRules).filter(id => relatedBuiltIns.has(id)).sort(),
    behavior: {
      language: config.language,
      mode: config.translate.mode,
      style: config.translate.translationNodeStyle,
      prompts: config.translate.customPromptsConfig,
      provider: activeProvider,
      hover: { enabled: config.features.hoverTranslation, stream: config.features.hoverStream, trigger: config.features.hoverHotkey },
    },
  }))
}

export function documentMatchesPage(document: SiteRuleDocument, config: SiteRulesConfig, url: string): boolean {
  if (!isSiteRuleDocumentForUrl(document, url))
    return false
  return document.changes.some((change) => {
    const rule = change.action === "upsert" ? change.rule : config.userRules.find(candidate => candidate.id === change.id)
    return rule !== undefined && urlMatchesRule(url, rule)
  })
}

export function buildSiteRuleAgentInstructions(config: Config, url: string, symptom = "请根据真实页面适配悬停翻译、正文范围与译文样式。"): string {
  const host = siteRuleHost(url)
  if (!host)
    return "请在 http 或 https 网站上打开 Readomi，再复制站点适配指令。"
  const effective = getEffectiveSiteRule(config, url)
  const builtIns = [...BUILT_IN_SITE_RULES, ...READOMI_SITE_RULES].filter(rule => effective.matchedRuleIds.includes(rule.id))
  const relatedUsers = config.siteRules.userRules.filter(rule => siteRuleTouchesHosts(rule, [host]))
  return [
    "请为 Readomi 适配这个网站，先查看真实 DOM 和实际交互，再生成单站点用户规则。",
    `Readomi 版本：${EXTENSION_VERSION}\n当前最终 URL：${url}\n精确主机名：${host}\n问题：${symptom}`,
    "目标：支持首页与详情、滚动加载和站内导航；译文遵循读者现有设置。不要修改内置规则，不要导入整份配置，不要要求读者编辑全部 userRules。",
    "交付 JSON 文档格式：{\"format\":\"readomi-site-rule\",\"version\":1,\"site\":{\"name\":\"网站名称\",\"hosts\":[\"精确主机名\"]},\"changes\":[{\"action\":\"upsert\",\"rule\":{\"id\":\"独立用户规则ID\",\"matches\":\"精确主机名\"}}]}。暂停现有用户规则用 {\"action\":\"disable\",\"id\":\"用户规则ID\"}。",
    "一份文档仅适配一个站点，matches/excludeMatches 必须限制到 site.hosts 的精确主机，可限制路径；不隐式包含 www、裸域或子域。规则 ID 不得使用内置 ID。upsert 完整替换同 ID 条目，因此更新时保留仍需生效的字段；其他 ID 保持原样。",
    "规则字段：id、description、matches、excludeMatches、enabled；includeSelectors/excludeSelectors、forceBlockNodeSelectors/forceInlineNodeSelectors、forceBlockStyleSelectors/forceInlineStyleSelectors、preserveTextSelectors/atomSelectors（均支持 .add 和 .remove）；translationGroups；minCharacters/minWords；injectedCss/injectedCss.add；dontWalkTags/dontWalkButTranslateTags/mainContentIgnoreTags/forceBlockTags/forceInlineTranslationTags 的 .add/.remove。标签列表填标签名，其他选择器列表填 CSS。",
    "选择器集合默认合并；移除旧选择器须明确使用 .remove。include 子树不会重新打开已被 exclude 阻断的祖先。节点分段和 block/inline 样式是两个独立字段；竖线只作用于块译文，需要同时确认正文容器分段和最终块译文。保留链接等原文。不要用全站 span、dir=auto 或大范围解除过滤来掩盖问题。CSS 不得加载资源或使用可执行声明。",
    "需要多个正文片段形成整帖译文时，使用 translationGroups:[{containerSelector,sourceSelectors,placement?,slot?}]。containerSelector 是一组的所属容器；sourceSelectors 相对它查询后代，支持 :scope，仅提取指定 light DOM 正文，不穿透 Shadow DOM。按选择器声明顺序收集，同一选择器内按 DOM 顺序；节点去重，已选外层来源覆盖其嵌套子来源，保留正文段落。一组一次请求、同一个译文容器；includeSelectors 不过滤整组提取内容，用户名、操作栏、图片、媒体和隐藏副本不能放入来源。相同 containerSelector 由后规则整项覆盖，不合并 sourceSelectors；sourceSelectors:[] 停止该组，没有 .add/.remove。",
    "placement 默认为 append，将译文插入组容器；可选 after 插到组容器之后。Shadow DOM 宿主必须有可显示新增译文的槽位：未填写 slot 需可见的 default slot；slot 可指定已有 named slot，必须为非空白字符串且只能配 append，after 不能同时填写 slot。等待、流式和完成使用同一个位置。Reddit 首页的 text-body 槽位让整帖译文始终在原文后、图片媒体前，图片帖的标题译文也使用同一槽。只译文模式仅替换指定正文来源，保留卡片元信息、媒体与操作。",
    "使用宿主网页内 Readomi 面板：先展开“更多”，再通过 readomi-rule-document-input 输入完整文档；readomi-rule-preview-action 临时预览，readomi-rule-report 读取结构化结果，readomi-rule-stop-action 停止。控件同时有可访问标签。可反复修改文档并重新预览；修改后旧结果失效，异步结果必须与当前文档的 revision 和 draftHash 一致。",
    "请实际观察键盘悬停、首次 hover（尚未开整页翻译）、首页/详情、多段/链接、滚动新帖、流式开关与等待/输出/完成排版、再次触发、停止预览与恢复。链接上的 clickAndHold 可能受现有引擎限制，不承诺用户规则能修复事件流程。不要把静态命中或推断说成实际通过。",
    "当前面板是临时会话。最终交付完整可复制文档、变更原因、验证过的 URL/场景和未验证项目；用户最后点击保存规则。不要通过保存按钮或其他存储路径替用户持久保存。",
    `相关阅读设置（无服务密钥）：\n${JSON.stringify({ language: config.language, mode: config.translate.mode, style: config.translate.translationNodeStyle, hover: { enabled: config.features.hoverTranslation, stream: config.features.hoverStream, trigger: config.features.hoverHotkey } }, null, 2)}`,
    `当前匹配的内置及兼容规则：\n${JSON.stringify(builtIns, null, 2)}`,
    `相关内置停用记录：\n${JSON.stringify(normalizeDisabledBuiltInRuleIds(config.siteRules.disabledBuiltInRules).filter(id => BUILT_IN_SITE_RULES.some(rule => rule.id === id && siteRuleTouchesHosts(rule, [host]))), null, 2)}`,
    `当前相关用户规则（更新同 ID 时保留所需字段）：\n${JSON.stringify(relatedUsers, null, 2)}`,
  ].join("\n\n")
}
