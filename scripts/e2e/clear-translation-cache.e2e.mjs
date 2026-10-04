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
  await popup.getByRole("button", { name: "Clear cache", exact: true }).waitFor()
  return { popup, worker }
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

async function seedSummary(worker) {
  await worker.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("JiandaoDB")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction("articleSummaryCache", "readwrite")
      transaction.objectStore("articleSummaryCache").put({ key: "e2e-summary-preserved", summary: "An existing article summary.", createdAt: new Date() })
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    }
    finally {
      database.close()
    }
  })
}

async function clearFromPopup(popup) {
  // Success and failure stay actionable; readers can clear again immediately.
  await popup.getByRole("button", { name: /^(?:Clear cache|Translation cache cleared|Could not clear\. Retry\.)$/ }).click()
  await popup.getByText("Translation cache cleared", { exact: true }).waitFor()
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
async function enqueue(popup, id, hash, text) {
  await popup.evaluate(async ({ id, hash, text }) => {
    const { config } = await chrome.storage.local.get("config")
    const providerConfig = config.providersConfig.find(provider => provider.id === config.translate.providerId)
    globalThis.e2eCacheRequests ??= new Map()
    const reply = chrome.runtime.sendMessage({
      kind: "readomi-message",
      type: "enqueueTranslateRequest",
      data: {
        text,
        hash,
        langConfig: config.language,
        providerConfig,
        customPromptsConfig: config.translate.customPromptsConfig,
        scheduleAt: Date.now(),
      },
    })
    globalThis.e2eCacheRequests.set(id, reply)
  }, { id, hash, text })
}

async function completedRequest(popup, id) {
  const reply = await popup.evaluate(id => globalThis.e2eCacheRequests.get(id), id)
  assert.equal(reply.ok, true, `the translation request ${id} still completes for its original caller`)
  return reply.response
}

it("clears translation cache from the popup while retaining summaries, configuration and displayed translations", async () => {
  const { popup, worker } = await setup()
  await screenshotFooter(popup)
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  await pressTranslateShortcut(article)
  const blocks = article.locator(".readomi-translated-block-content")
  await blocks.nth(4).waitFor({ timeout: 20_000 })
  await article.locator(".readomi-spinner").first().waitFor({ state: "detached" })
  await waitFor(() => caches(worker), value => value.translations.length > 0, "successful translations are cached")
  await seedSummary(worker)
  const before = await caches(worker)
  const configuration = await storedConfig(context)
  const displayed = await blocks.allTextContents()
  const requests = service.translationRequests().length

  await clearFromPopup(popup)
  const after = await caches(worker)
  assert.deepEqual(after.translations, [], "all stored translation entries were cleared")
  assert.deepEqual(after.summaries, before.summaries, "article summaries remain stored")
  assert.deepEqual(await storedConfig(context), configuration, "clearing does not change saved preferences or services")
  assert.deepEqual(await blocks.allTextContents(), displayed, "already displayed translations remain readable")
  assert.equal(service.translationRequests().length, requests, "clearing does not automatically translate the page again")
  await assertFooterFits(popup)
  await screenshot(popup, "popup-translation-cache-cleared.png")

  await pressTranslateShortcut(article)
  await blocks.first().waitFor({ state: "detached" })
  await pressTranslateShortcut(article)
  await blocks.nth(4).waitFor({ timeout: 20_000 })
  assert.ok(service.translationRequests().length > requests, "the next translation reaches the provider instead of reusing cleared entries")
  await waitFor(() => caches(worker), value => value.translations.length > 0, "new successful translations rebuild the cache")
  assert.deepEqual((await caches(worker)).summaries, before.summaries)

  // Locale preparation is separate from the cache invariants above. Check a
  // longer footer label with the same 320px viewport and restore preferences.
  await worker.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.ui.language = "ru"
    await chrome.storage.local.set({ config })
  })
  try {
    const russianClear = popup.getByRole("button", { name: /^(?:Очистить кэш|Кэш переводов очищен)$/ })
    await russianClear.waitFor()
    await assertFooterFits(popup)
    await russianClear.click()
    await popup.getByText("Кэш переводов очищен", { exact: true }).waitFor()
    await assertFooterFits(popup)
    await screenshot(popup, "popup-translation-cache-cleared-ru.png")
  }
  finally {
    await worker.evaluate(async (language) => {
      const { config } = await chrome.storage.local.get("config")
      config.ui.language = language
      await chrome.storage.local.set({ config })
    }, configuration.ui.language)
  }
  assert.deepEqual(await storedConfig(context), configuration, "locale layout checks restore the saved preferences")
})

it("keeps pre-clear in-flight results out of the cache and starts a fresh request for the same hash after clearing", async () => {
  const { popup, worker } = await setup()
  const text = "The reader can keep the code and names unchanged in this sentence."
  releaseAnswers = service.holdAnswers()
  const beforeOld = service.translationRequests().length
  await enqueue(popup, "old-only", "e2e-cache-old-only", text)
  await waitFor(() => service.translationRequests().length, value => value === beforeOld + 1, "the provider received a request before clearing")
  await clearFromPopup(popup)
  assert.deepEqual((await caches(worker)).translations, [], "an empty cache can still be cleared while a request is in flight")
  releaseAnswers()
  releaseAnswers = undefined
  await completedRequest(popup, "old-only")
  assert.deepEqual((await caches(worker)).translations, [], "the completed pre-clear request does not repopulate the cache")

  releaseAnswers = service.holdAnswers()
  const beforeSameHash = service.translationRequests().length
  await enqueue(popup, "old-shared", "e2e-cache-shared", text)
  await waitFor(() => service.translationRequests().length, value => value === beforeSameHash + 1, "the first shared-hash request reached the provider")
  await clearFromPopup(popup)
  await enqueue(popup, "new-shared", "e2e-cache-shared", text)
  await waitFor(() => service.translationRequests().length, value => value === beforeSameHash + 2, "clearing separates the new shared-hash request from the old pending promise")
  releaseAnswers()
  releaseAnswers = undefined
  await Promise.all([completedRequest(popup, "old-shared"), completedRequest(popup, "new-shared")])
  const final = await caches(worker)
  assert.deepEqual(final.translations.map(record => record.key), ["e2e-cache-shared"], "only a result from the new cache generation is stored")
})
