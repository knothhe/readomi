import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { readFile } from "node:fs/promises"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure, storedConfig } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service

afterEach(async (test) => {
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
    context = undefined
    service = undefined
  }
})

async function setUp() {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  return launched
}

it("manual setup and local backup restore work without an account", async () => {
  const { page, extensionId } = await setUp()
  const doc = setupDocumentFor(service.origin)
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await page.getByRole("button", { name: "Manual setup", exact: true }).click()
  await page.getByLabel("Service type").selectOption("openai-compatible")
  await page.getByLabel("API URL", { exact: true }).fill(doc.baseURL)
  await page.getByLabel("API Key", { exact: true }).fill(doc.apiKey)
  await page.getByLabel("Model", { exact: true }).fill(doc.model)
  await page.getByRole("button", { name: "Test and save", exact: true }).click()
  await page.getByText("Connected", { exact: true }).waitFor()
  const saved = await storedConfig(context)
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export configuration", exact: true }).click()
  const download = await downloadPromise
  const backup = JSON.parse(await readFile(await download.path(), "utf8"))
  assert.equal(backup.format, "reading-config")
  assert.equal(backup.config.providersConfig.find(p => p.id === backup.config.translate.providerId).apiKey, doc.apiKey)
  backup.config.features.hoverTranslation = true
  await page.getByLabel("Import configuration", { exact: true }).setInputFiles({ name: "reading-config.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole("button", { name: "Replace all settings", exact: true }).waitFor()
  assert.equal((await storedConfig(context)).features.hoverTranslation, false)
  await page.getByRole("button", { name: "Replace all settings", exact: true }).click()
  await page.getByText("Configuration imported.", { exact: true }).waitFor()
  const restored = await storedConfig(context)
  assert.equal(restored.features.hoverTranslation, true)
  assert.equal(restored.translate.providerId, saved.translate.providerId)
  await page.getByRole("button", { name: "Manual setup", exact: true }).click()
  await page.screenshot({ path: "/tmp/reading-manual-settings.png", fullPage: true })
})

it("hover translates and restores one paragraph without enabling whole-page translation", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.getByRole("switch", { name: "Hover translation", exact: true }).click()
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  await article.bringToFront()
  const paragraph = article.locator("p").first()
  await paragraph.hover()
  await article.keyboard.down("Alt")
  await article.waitForTimeout(650)
  await article.keyboard.up("Alt")
  await article.locator(".jiandao-translated-block-content").waitFor({ timeout: 15_000 })
  assert.equal(await article.locator(".jiandao-translated-block-content").count(), 1)
  assert.equal(await article.locator("h1 .jiandao-translated-block-content").count(), 0)
  await paragraph.hover()
  await article.keyboard.down("Alt")
  await article.waitForTimeout(650)
  await article.keyboard.up("Alt")
  await article.locator(".jiandao-translated-block-content").waitFor({ state: "detached" })
})

it("caption DOM translates locally and closing the feature restores the player", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  await article.evaluate(() => {
    const player = document.createElement("div")
    player.className = "html5-video-player"
    player.innerHTML = "<video style=\"width:640px;height:360px\"></video><div class=\"ytp-caption-window-container\"><span class=\"ytp-caption-segment\">Reading matters.</span></div>"
    document.body.prepend(player)
  })
  await article.locator("[data-reading-subtitles]").waitFor()
  await article.waitForFunction(() => getComputedStyle(document.querySelector(".ytp-caption-window-container")).visibility === "hidden")
  const limit = Date.now() + 15_000
  while (!service.completions().some(r => r.body.includes("Reading matters."))) {
    assert.ok(Date.now() < limit, "subtitle text reached the configured local API")
    await article.waitForTimeout(100)
  }
  await page.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  await article.locator("[data-reading-subtitles]").waitFor({ state: "detached" })
  assert.notEqual(await article.locator(".ytp-caption-window-container").evaluate(el => getComputedStyle(el).visibility), "hidden")
})
