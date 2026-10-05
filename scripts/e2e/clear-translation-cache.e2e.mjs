/* global chrome -- callbacks run in isolated extension pages and the service worker. */
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, pressTranslateShortcut, reportFailure, storedConfig } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
let releaseAnswers

afterEach(async (test) => {
  try {
    releaseAnswers?.()
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
    context = undefined
    service = undefined
    releaseAnswers = undefined
  }
})

async function waitFor(read, predicate, description) {
  const deadline = Date.now() + 15_000
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value))
      return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`${description}: ${JSON.stringify(value)}`)
}

async function setup() {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  const worker = context.serviceWorkers()[0]
  await worker.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.translate.enableAIContentAware = false
    await chrome.storage.local.set({ config })
  })
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 320, height: 640 })
  await popup.goto(`chrome-extension://${launched.extensionId}/popup.html`)
  const article = await context.newPage()
  await article.goto(`${service.origin}/article?id=a`)
  await article.bringToFront()
  await popup.reload()
  await popup.getByRole("button", { name: "Clear this page’s cache", exact: true }).waitFor()
  return { popup, worker, article, extensionId: launched.extensionId }
}

async function caches(worker) {
  return worker.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("JiandaoDB")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction(["translationCache", "articleSummaryCache"], "readonly")
      const read = name => new Promise((resolve, reject) => {
        const request = transaction.objectStore(name).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const [translations, summaries] = await Promise.all([read("translationCache"), read("articleSummaryCache")])
      return { translations, summaries }
    }
    finally {
      database.close()
    }
  })
}

async function seedSummary(worker, pageUrl) {
  await worker.evaluate(async (pageUrl) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("JiandaoDB")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pageUrl))
      const pageKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
      const transaction = database.transaction("articleSummaryCache", "readwrite")
      transaction.objectStore("articleSummaryCache").put({ key: `e2e-summary-${pageKey}`, pageKey, summary: "An existing article summary.", createdAt: new Date() })
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    }
    finally {
      database.close()
    }
  }, pageUrl)
}

async function clearFromPopup(popup) {
  // Success and failure stay actionable; readers can clear again immediately.
  await popup.getByRole("button", { name: /^(?:Clear this page’s cache|This page’s cache was cleared|Could not clear this page’s cache. Try again.)$/ }).click()
  await popup.getByRole("button", { name: "This page’s cache was cleared", exact: true }).waitFor()
}

async function screenshot(page, name) {
  if (!process.env.E2E_ARTIFACTS)
    return
  await mkdir(process.env.E2E_ARTIFACTS, { recursive: true })
  await page.screenshot({ path: resolve(process.env.E2E_ARTIFACTS, name), fullPage: true })
}

async function screenshotFooter(popup) {
  if (!process.env.E2E_ARTIFACTS)
    return
  await mkdir(process.env.E2E_ARTIFACTS, { recursive: true })
  await popup.locator("footer").screenshot({ path: resolve(process.env.E2E_ARTIFACTS, "popup-translation-cache-footer-default.png") })
}

async function assertFooterFits(popup) {
  const overflow = await popup.locator("footer button").evaluateAll(buttons => buttons
    .filter(button => button.getClientRects().length)
    .filter((button) => {
      const rect = button.getBoundingClientRect()
      return rect.width <= 0 || rect.left < 0 || rect.right > innerWidth
    })
    .map(button => button.getAttribute("aria-label") ?? button.textContent))
  assert.deepEqual(overflow, [], "footer actions remain inside the 320px popup")
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const provider = popup.locator("footer > button[aria-haspopup='menu']")
  await provider.click()
  const menu = popup.getByRole("menu")
  await menu.waitFor()
  await menu.press("Escape")
  assert.equal(await menu.count(), 0, "the service switcher remains actionable beside the clear action")
}

/** Hold a real background response without blocking the popup.evaluate call. */
async function enqueue(popup, id, hash, text, pageUrl) {
  await popup.evaluate(async ({ id, hash, text, pageUrl }) => {
    const { config } = await chrome.storage.local.get("config")
    const providerConfig = config.providersConfig.find(provider => provider.id === config.translate.providerId)
    globalThis.e2eCacheRequests ??= new Map()
    const reply = chrome.runtime.sendMessage({
      kind: "readomi-message",
      type: "enqueueTranslateRequest",
      data: {
        text,
        hash,
        pageUrl,
        langConfig: config.language,
        providerConfig,
        customPromptsConfig: config.translate.customPromptsConfig,
        scheduleAt: Date.now(),
      },
    })
    globalThis.e2eCacheRequests.set(id, reply)
  }, { id, hash, text, pageUrl })
}

async function completedRequest(popup, id) {
  const reply = await popup.evaluate(id => globalThis.e2eCacheRequests.get(id), id)
  assert.equal(reply.ok, true, `the translation request ${id} still completes for its original caller`)
  return reply.response
}

it("clears only this page's text and summary caches, retains visible translations, and clears all from settings", async () => {
  const { popup, worker, article, extensionId } = await setup()
  await screenshotFooter(popup)
  await pressTranslateShortcut(article)
  const blocks = article.locator(".readomi-translated-block-content")
  await blocks.nth(4).waitFor({ timeout: 20_000 })
  await article.locator(".readomi-spinner").first().waitFor({ state: "detached" })
  await seedSummary(worker, article.url())
  const other = await context.newPage()
  await other.goto(`${service.origin}/article?id=b`)
  await pressTranslateShortcut(other)
  await other.locator(".readomi-translated-block-content").nth(4).waitFor({ timeout: 20_000 })
  await other.locator(".readomi-spinner").first().waitFor({ state: "detached" })
  await seedSummary(worker, other.url())
  const before = await caches(worker)
  assert.equal(new Set(before.translations.map(record => record.pageKey)).size, 2)
  const configuration = await storedConfig(context)
  const displayed = await blocks.allTextContents()
  const requests = service.translationRequests().length
  await article.bringToFront()
  await popup.reload()
  await clearFromPopup(popup)
  const after = await caches(worker)
  assert.ok(after.translations.length > 0, "another page retains its translations")
  assert.equal(new Set(after.translations.map(record => record.pageKey)).size, 1)
  assert.equal(after.summaries.length, 1, "only this page's summary was cleared")
  assert.ok(after.translations.every(record => record.pageKey === after.summaries[0].pageKey))
  assert.deepEqual(await storedConfig(context), configuration)
  assert.deepEqual(await blocks.allTextContents(), displayed)
  assert.equal(service.translationRequests().length, requests)
  await assertFooterFits(popup)
  await screenshot(popup, "popup-translation-cache-cleared.png")
  await pressTranslateShortcut(article)
  await blocks.first().waitFor({ state: "detached" })
  await pressTranslateShortcut(article)
  await blocks.nth(4).waitFor({ timeout: 20_000 })
  assert.ok(service.translationRequests().length > requests)
  await waitFor(() => caches(worker), value => new Set(value.translations.map(record => record.pageKey)).size === 2, "this page builds a fresh cache")
  const settings = await context.newPage()
  await settings.goto(`chrome-extension://${extensionId}/options.html#backup`)
  await settings.locator("#backup").getByRole("button", { name: "Clear", exact: true }).click()
  await settings.getByText("All translation and summary caches were cleared.", { exact: true }).waitFor()
  assert.deepEqual(await caches(worker), { translations: [], summaries: [] })
  assert.deepEqual(await storedConfig(context), configuration)
  assert.deepEqual(await blocks.allTextContents(), displayed)
  await screenshot(settings, "settings-cache-cleared.png")
})

it("keeps pre-clear in-flight results out of the cache and starts a fresh request for the same hash after clearing", async () => {
  const { popup, worker, article } = await setup()
  const text = "The reader can keep the code and names unchanged in this sentence."
  releaseAnswers = service.holdAnswers()
  const beforeOld = service.translationRequests().length
  await enqueue(popup, "old-only", "e2e-cache-old-only", text, article.url())
  await waitFor(() => service.translationRequests().length, value => value === beforeOld + 1, "the provider received a request before clearing")
  await clearFromPopup(popup)
  assert.deepEqual((await caches(worker)).translations, [], "an empty cache can still be cleared while a request is in flight")
  releaseAnswers()
  releaseAnswers = undefined
  await completedRequest(popup, "old-only")
  assert.deepEqual((await caches(worker)).translations, [], "the completed pre-clear request does not repopulate the cache")

  releaseAnswers = service.holdAnswers()
  const beforeSameHash = service.translationRequests().length
  await enqueue(popup, "old-shared", "e2e-cache-shared", text, article.url())
  await waitFor(() => service.translationRequests().length, value => value === beforeSameHash + 1, "the first shared-hash request reached the provider")
  await clearFromPopup(popup)
  await enqueue(popup, "new-shared", "e2e-cache-shared", text, article.url())
  await waitFor(() => service.translationRequests().length, value => value === beforeSameHash + 2, "clearing separates the new shared-hash request from the old pending promise")
  releaseAnswers()
  releaseAnswers = undefined
  await Promise.all([completedRequest(popup, "old-shared"), completedRequest(popup, "new-shared")])
  const final = await caches(worker)
  assert.equal(final.translations.length, 1, "only a result from the new cache generation is stored")
  assert.ok(final.translations[0].pageKey, "the stored result belongs to the current page")
})

it("retries failed paragraphs and retranslates an already translated page", async () => {
  const { popup, worker, article } = await setup()
  const setModel = model => worker.evaluate(async (model) => {
    const { config } = await chrome.storage.local.get("config")
    config.providersConfig.find(provider => provider.id === config.translate.providerId).model = model
    await chrome.storage.local.set({ config })
  }, model)
  await setModel("rejected-model")
  await pressTranslateShortcut(article)
  await article.getByText("Check your translation service or try again. See error details for more information.").first().waitFor({ timeout: 20_000 })
  await setModel("fake-model")
  await article.bringToFront()
  await popup.reload()
  await popup.getByRole("button", { name: "Retry failed paragraphs", exact: true }).click()
  const blocks = article.locator(".readomi-translated-block-content")
  await blocks.nth(4).waitFor({ timeout: 20_000 })
  await waitFor(() => article.getByText("Check your translation service or try again. See error details for more information.").count(), value => value === 0, "all failed paragraphs recover")
  await screenshot(popup, "popup-recovered.png")
  const requests = service.translationRequests().length
  await popup.getByRole("button", { name: "Retranslate this page", exact: true }).click()
  await waitFor(() => service.translationRequests().length, value => value > requests, "retranslation requests fresh provider results")
  await blocks.nth(4).waitFor({ timeout: 20_000 })
  assert.equal(await blocks.count(), 5)
})

it("keeps video settings directly visible on articles and reports a detected player’s subtitle status", async () => {
  const { popup, article, worker } = await setup()
  const section = popup.getByRole("region", { name: "Video subtitles", exact: true })
  await section.getByRole("switch", { name: "Video subtitle translation", exact: true }).waitFor()
  assert.equal(await popup.locator("summary").filter({ hasText: "Video subtitles" }).count(), 0)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await section.getByRole("status").count(), 0, "pages without videos have no subtitle status notice")
  assert.equal(await section.getByRole("button", { name: "Style and position", exact: true }).count(), 0)
  await article.evaluate(() => {
    const video = document.createElement("video")
    video.style.cssText = "display:block;width:640px;height:360px"
    document.body.prepend(video)
    const track = video.addTextTrack("subtitles", "English", "en")
    track.mode = "showing"
    track.addCue(new VTTCue(0, 60, "A readable subtitle."))
  })
  await popup.getByText("Enable subtitle translation to read the player’s existing captions.", { exact: true }).waitFor()
  assert.equal(await section.isVisible(), true)
  await section.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  await popup.getByText("Subtitle translation is ready.", { exact: true }).waitFor({ timeout: 20_000 })
  await screenshot(popup, "popup-video-ready.png")
  assert.equal(await section.isVisible(), true, "subtitle settings remain directly accessible")
  await worker.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.ui.language = "zh-CN"
    config.appearance.mode = "dark"
    await chrome.storage.local.set({ config })
  })
  await popup.getByText("翻译有问题？", { exact: true }).click()
  await popup.getByRole("button", { name: "调整译文质量", exact: true }).waitFor()
  assert.equal(await popup.getByRole("button", { name: "清理当前页缓存", exact: true }).getAttribute("title"), "清理当前页缓存，保留已有译文。")
  await screenshot(popup, "popup-help-actions-dark.png")
  if (process.env.E2E_ARTIFACTS) {
    const help = popup.locator("details").filter({ has: popup.locator("summary").filter({ hasText: "翻译有问题？" }) })
    await help.screenshot({ path: resolve(process.env.E2E_ARTIFACTS, "popup-help-actions-detail.png") })
  }
})
