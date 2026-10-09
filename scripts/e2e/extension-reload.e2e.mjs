/* global chrome */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { configureService, launchBrowser, pressTranslateShortcut, reportFailure } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
let releaseAnswers

afterEach(async (test) => {
  releaseAnswers?.()
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
  }
})

it("reloads during active translation without errors and disposes the old page's listeners", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  const worker = context.serviceWorkers()[0]
  await worker.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.videoSubtitles = true
    config.reading.wordPrefixEmphasis = true
    config.translate.enableAIContentAware = true
    await chrome.storage.local.set({ config })
  })
  const extensions = await context.newPage()
  await extensions.goto("chrome://extensions/")
  // Command-line loading works without developer mode, but reloading requires it.
  await extensions.getByRole("button", { name: "Developer mode", exact: true }).click()
  const article = await context.newPage()
  await context.route(`${service.origin}/favicon.ico`, route => route.fulfill({ status: 204 }))
  const errors = []
  article.on("pageerror", error => errors.push(error.stack ?? String(error)))
  article.on("console", (message) => {
    if (message.type() === "error")
      errors.push(message.text())
  })
  // Content-script exceptions are in an isolated world, outside pageerror.
  const debug = await context.newCDPSession(article)
  await debug.send("Runtime.enable")
  debug.on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text))
  debug.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error")
      errors.push(event.args.map(arg => arg.description ?? arg.value).join(" "))
  })
  await article.goto(`${service.origin}/article`)
  await article.locator("[data-readomi-host-toast]").first().waitFor({ state: "attached" })
  await article.evaluate(() => {
    const video = document.createElement("video")
    document.body.prepend(video)
  })
  await article.locator("[data-readomi-subtitles]").waitFor({ state: "attached" })
  releaseAnswers = service.holdAnswers()
  const before = service.completions().length
  await pressTranslateShortcut(article)
  // The language/context request is still waiting on the background when it unloads.
  for (let attempt = 0; attempt < 100 && service.completions().length === before; attempt++)
    await delay(50)
  assert.ok(service.completions().length > before, "background request should be in flight")
  await extensions.getByRole("button", { name: "Reload", exact: true }).click()
  await article.waitForFunction(() => !document.querySelector("[data-readomi-host-toast]"))
  await article.locator("[data-readomi-subtitles]").waitFor({ state: "detached" })
  releaseAnswers()
  const requestsAfterReload = service.completions().length
  // Wake visibility handlers and DOM observers on the abandoned page.
  await launched.page.bringToFront().catch(() => {})
  await article.bringToFront()
  await article.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"))
    document.body.append(document.createElement("video"))
    const paragraph = document.createElement("p")
    paragraph.textContent = "A newly inserted paragraph must not wake the old translation manager."
    document.body.append(paragraph)
  })
  await pressTranslateShortcut(article)
  await article.waitForTimeout(1500)
  assert.equal(service.completions().length, requestsAfterReload)
  assert.equal(await article.locator("[data-readomi-subtitles]").count(), 0)
  assert.equal(await article.getByRole("button", { name: "Retry", exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  // Reloading the document starts a usable fresh content script.
  const options = await context.newPage()
  await options.goto(`chrome-extension://${launched.extensionId}/options.html`)
  await article.reload()
  await article.locator("[data-readomi-host-toast]").first().waitFor({ state: "attached" })
  await pressTranslateShortcut(article)
  await article.locator(".readomi-translated-block-content").first().waitFor({ timeout: 15000 })
  assert.deepEqual(errors, [])
  // Repeated reloads also interrupt state synchronization and cached translations.
  for (let attempt = 0; attempt < 2; attempt++) {
    await extensions.getByRole("button", { name: "Reload", exact: true }).click()
    await article.waitForFunction(() => !document.querySelector("[data-readomi-host-toast]"))
    assert.deepEqual(errors, [])
    assert.equal(await article.getByRole("button", { name: "Retry", exact: true }).count(), 0)
    await article.reload()
    await article.locator("[data-readomi-host-toast]").first().waitFor({ state: "attached" })
    await pressTranslateShortcut(article)
    await article.locator(".readomi-translated-block-content").first().waitFor({ timeout: 15000 })
    assert.deepEqual(errors, [])
  }
  // An idle manager also tears down silently, including Chrome's extension log.
  await pressTranslateShortcut(article)
  await article.locator(".readomi-translated-block-content").first().waitFor({ state: "detached" })
  await extensions.getByRole("button", { name: "Reload", exact: true }).click()
  await article.waitForFunction(() => !document.querySelector("[data-readomi-host-toast]"))
  await extensions.goto(`chrome://extensions/?errors=${launched.extensionId}`)
  await extensions.getByRole("heading", { name: "Errors", exact: true }).waitFor()
  assert.equal(await extensions.getByRole("button", { name: /^(Error|Warning) / }).count(), 0)
  assert.deepEqual(errors, [])
})
