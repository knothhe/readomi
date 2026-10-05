import type { RequestErrorMeta } from "./request/retry-policy"
import type { LangCodeISO6393 } from "@/definitions"
import type {
  BackgroundGenerateTextPayload,
  BackgroundGenerateTextResponse,
} from "@/types/background-generate-text"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { SubtitleStyle } from "@/types/config/subtitle-style"
import type { SubtitleStatus } from "@/types/subtitle-status"
import type { TranslationProgress } from "@/types/translation-progress"
import type { TranslationResult } from "@/utils/host/translate/translation-result"
import type { LanguagePolicyConfig } from "@/utils/language-policy"
import type { SiteRuleSession, SiteRuleSessionResult } from "@/utils/site-rules/document"
import { browser } from "#imports"
import { isExtensionContextInvalidatedError, isExtensionContextValid, isMessageConnectionLostError } from "./extension-context"
import { attachRequestErrorMeta, getRequestErrorMeta } from "./request/retry-policy"

interface ProtocolMap {
  // navigation
  openOptionsPage: (data?: { section?: string }) => void
  openSiteRulePanel: () => void
  getSiteRuleSession: () => Promise<SiteRuleSessionResult>
  setSiteRuleDraft: (data: { text: string }) => Promise<SiteRuleSessionResult>
  previewSiteRuleDraft: (data: { revision: number }) => Promise<SiteRuleSessionResult>
  ackSiteRulePreview: (data: { revision: number, draftHash: string, readableBodyCount: number, url: string }) => Promise<SiteRuleSessionResult>
  saveSiteRuleDraft: (data: { revision: number }) => Promise<SiteRuleSessionResult>
  stopSiteRulePreview: () => Promise<SiteRuleSessionResult>
  undoSiteRuleSave: () => Promise<SiteRuleSessionResult>
  siteRuleSessionChanged: (data: { session: SiteRuleSession | null }) => void
  saveSubtitleStylePatch: (data: { patch: Partial<SubtitleStyle> }) => Promise<void>
  // translation state
  getEnablePageTranslationByTabId: (data: { tabId: number }) => boolean | undefined
  getEnablePageTranslationFromContentScript: () => Promise<boolean>
  tryToSetEnablePageTranslationByTabId: (data: { tabId: number, enabled: boolean }) => void
  setAndNotifyPageTranslationStateChangedByManager: (data: { enabled: boolean, url?: string }) => void
  notifyTranslationStateChanged: (data: { enabled: boolean }) => void
  reportDetectedPageLanguage: (data: { detectedCodeOrUnd: LangCodeISO6393 | "und", url: string }) => void
  refreshDetectedPageLanguage: () => void
  getDetectedCode: () => LangCodeISO6393
  detectedPageLanguageChanged: (data: { detectedCode: LangCodeISO6393 }) => void
  // broadcast to extension pages (popup) when a tab's translation state changes
  pageTranslationStateChanged: (data: { tabId: number, enabled: boolean }) => void
  // ask host to start page translation
  askManagerToTogglePageTranslation: (data: { enabled: boolean }) => void
  refreshPageTranslation: (data: { url: string, failedOnly: boolean }) => Promise<void>
  getSubtitleStatus: () => SubtitleStatus
  getTabSubtitleStatus: (data: { tabId: number }) => Promise<SubtitleStatus>
  retrySubtitleTranslation: () => void
  // translation progress (content script -> background -> popup)
  reportTranslationProgress: (data: TranslationProgress) => void
  getTranslationProgressByTabId: (data: { tabId: number }) => TranslationProgress | null
  translationProgressChanged: (data: { tabId: number, progress: TranslationProgress }) => void
  // request
  clearTranslationCache: () => Promise<void>
  clearPageTranslationCache: (data: { tabId: number, url: string }) => Promise<void>
  enqueueTranslateRequest: (data: { text: string, langConfig: LanguagePolicyConfig, providerConfig: ProviderConfig, scheduleAt: number, hash: string, pageUrl?: string, customPromptsConfig?: Config["translate"]["customPromptsConfig"], webTitle?: string | null, webDescription?: string | null, webContent?: string | null, webSummary?: string | null }) => Promise<TranslationResult>
  getOrGenerateWebPageSummary: (data: { webTitle: string, webContent: string, providerConfig: ProviderConfig, pageUrl?: string }) => Promise<string | null>
  backgroundGenerateText: (data: BackgroundGenerateTextPayload) => Promise<BackgroundGenerateTextResponse>
}

type MessageType = keyof ProtocolMap
type DataOf<T extends MessageType> = Parameters<ProtocolMap[T]>[0]
type ResponseOf<T extends MessageType> = Awaited<ReturnType<ProtocolMap[T]>>
type MessageSender = Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1]

export interface Message<T extends MessageType> {
  data: DataOf<T>
  sender: MessageSender | undefined
}

type Handler<T extends MessageType> = (message: Message<T>) => ResponseOf<T> | Promise<ResponseOf<T>>

/** Every message is one of these; anything else on the channel is someone else's. */
const ENVELOPE = "readomi-message"

interface Envelope {
  kind: typeof ENVELOPE
  type: MessageType
  data: unknown
}

type Reply
  = | { ok: true, response: unknown }
    | { ok: false, error: { name: string, message: string, requestErrorMeta?: Pick<RequestErrorMeta, "statusCode" | "isRetryable"> } }

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && (value as Envelope).kind === ENVELOPE && typeof (value as Envelope).type === "string"
}

const handlers = new Map<MessageType, Handler<MessageType>>()

async function dispatch(envelope: Envelope, sender: MessageSender | undefined): Promise<Reply> {
  const handler = handlers.get(envelope.type)
  if (!handler)
    throw new Error(`No handler for ${envelope.type}`)
  try {
    return { ok: true, response: await handler({ data: envelope.data as never, sender }) }
  }
  catch (error) {
    // Keep retry decisions intact across Chrome's JSON message boundary.
    // Response bodies and headers stay in the context that made the request.
    const { statusCode, isRetryable } = getRequestErrorMeta(error)
    return { ok: false, error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      requestErrorMeta: { statusCode, isRetryable },
    } }
  }
}

function onRuntimeMessage(raw: unknown, sender: MessageSender, sendResponse?: (reply: Reply) => void) {
  if (!isEnvelope(raw) || !handlers.has(raw.type))
    return undefined
  const reply = dispatch(raw, sender)
  // Chrome expects `sendResponse` plus `true`; Firefox and the test browser accept the promise.
  if (typeof sendResponse === "function") {
    void reply.then(sendResponse)
    return true
  }
  return reply
}

function ensureListening() {
  if (!browser.runtime.onMessage.hasListener(onRuntimeMessage))
    browser.runtime.onMessage.addListener(onRuntimeMessage)
}

/**
 * Registers the handler for one message type in this context (background,
 * popup, options or a content script). Returns the function that removes it.
 */
export function onMessage<T extends MessageType>(type: T, handler: Handler<T>): () => void {
  ensureListening()
  handlers.set(type, handler as Handler<MessageType>)
  return () => {
    if (handlers.get(type) === handler)
      handlers.delete(type)
  }
}

/**
 * Sends to the background (or, with `tabId`, to that tab's content scripts)
 * and resolves with the handler's return value. A handler error is rethrown
 * here with its message; no handler anywhere rejects as the browser does.
 */
export async function sendMessage<T extends MessageType>(
  type: T,
  ...args: DataOf<T> extends undefined ? [data?: DataOf<T>, tabId?: number, frameId?: number] : [data: DataOf<T>, tabId?: number, frameId?: number]
): Promise<ResponseOf<T>> {
  const [data, tabId, frameId] = args
  const envelope: Envelope = { kind: ENVELOPE, type, data }
  let reply: Reply | undefined
  try {
    reply = tabId === undefined
      ? await browser.runtime.sendMessage(envelope)
      : frameId === undefined ? await browser.tabs.sendMessage(tabId, envelope) : await browser.tabs.sendMessage(tabId, envelope, { frameId })
    if (reply === undefined)
      throw new Error(`No handler answered ${type}`)
  }
  catch (error) {
    // Chrome closes pending ports before invalidating the content context.
    // Let that unload finish before deciding whether this is a request failure.
    if (isMessageConnectionLostError(error))
      await new Promise(resolve => setTimeout(resolve, 250))
    if (!isExtensionContextValid() || isExtensionContextInvalidatedError(error))
      throw new Error("Extension context invalidated.")
    throw error
  }
  if (!reply.ok) {
    const error = new Error(reply.error.message)
    error.name = reply.error.name
    if (reply.error.requestErrorMeta)
      attachRequestErrorMeta(error, reply.error.requestErrorMeta)
    throw error
  }
  return reply.response as ResponseOf<T>
}
