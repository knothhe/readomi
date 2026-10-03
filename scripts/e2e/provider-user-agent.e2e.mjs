/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, it } from "node:test"
import { configureService, extensionPath, launchBrowser, reportFailure } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
let release

afterEach(async (test) => {
  release?.()
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
    context = undefined
    service = undefined
    release = undefined
  }
})

it("identifies connection checks, model discovery and streaming translations as Readomi without changing article navigation", async () => {
  service = await startFakeService({ streaming: true })
  const { version } = JSON.parse(await readFile(resolve(extensionPath, "manifest.json"), "utf8"))
  const expectedUserAgent = `Readomi/${version}`
  const launched = await launchBrowser()
  context = launched.context
  const { page: settings, extensionId } = launched

  // Check the header at the HTTP server, after Chrome has sent the request.
  // A fetch mock would miss Chrome silently replacing a User-Agent header.
  await configureService(settings, extensionId, setupDocumentFor(service.origin))
  const confirmation = service.completions().at(-1)
  assert.ok(confirmation, "applying the service sent a connection check")
  assert.equal(confirmation.userAgent, expectedUserAgent)
  assert.equal(confirmation.authorization, "Bearer local-secret-key")
  assert.notEqual(JSON.parse(confirmation.body).stream, true, "the connection check uses a normal POST")

  const section = settings.locator("#service")
  await section.getByRole("button", { name: "Manual setup", exact: true }).click()
  await section.getByRole("button", { name: "Fetch models", exact: true }).click()
  const models = section.getByRole("combobox", { name: "Select a model", exact: true })
  await models.waitFor()
  assert.deepEqual(await models.locator("option").allTextContents(), ["Select a model", "fake-model", "second-model"])
  const discovery = service.requests.find(request => request.method === "GET" && request.url === "/v1/models")
  assert.ok(discovery, "model discovery reached the service")
  assert.equal(discovery.userAgent, expectedUserAgent)
  assert.equal(discovery.authorization, "Bearer local-secret-key")

  // The article shares the API's origin. Changing an origin-wide header
  // would incorrectly brand this ordinary browser navigation, too.
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.hoverTranslation = true
    config.features.hoverStream = true
    config.translate.enableAIContentAware = false
    await chrome.storage.local.set({ config })
  })
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  const navigation = service.articleRequests.at(-1)
  assert.ok(navigation, "the article reached the same HTTP server")
  assert.match(navigation.userAgent, /^Mozilla\//)
  assert.equal(navigation.userAgent, await article.evaluate(() => navigator.userAgent))

  release = service.holdStreamCompletion()
  await article.locator("p").first().hover()
  await article.keyboard.press("Alt")
  const preview = article.locator("[data-readomi-inline-preview]")
  await preview.locator(".content").getByText(/阅读和经历/).waitFor({ timeout: 15_000 })
  const streamed = service.completions().find(request => JSON.parse(request.body).stream === true)
  assert.ok(streamed, "hover translation opened a real streaming request")
  assert.equal(streamed.userAgent, expectedUserAgent)
  assert.equal(streamed.authorization, "Bearer local-secret-key")
  release()
  release = undefined
  await preview.waitFor({ state: "detached", timeout: 15_000 })
  await article.locator("p").first().getByText(/阅读和经历/).waitFor()

  await article.reload()
  assert.equal(service.articleRequests.at(-1).userAgent, navigation.userAgent, "API and streaming requests do not change subsequent page navigation")
})
