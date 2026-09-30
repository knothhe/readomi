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

it("fetches models from the configured API and preserves drafts across sidebar and history navigation", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.getByRole("button", { name: "Manual setup", exact: true }).click()
  assert.equal(service.requests.filter(r => r.url === "/v1/models").length, 0)
  await page.getByRole("button", { name: "Fetch models", exact: true }).click()
  await page.getByLabel("Select a model").selectOption("second-model")
  const request = service.requests.find(r => r.url === "/v1/models")
  assert.equal(request.authorization, "Bearer local-secret-key")
  await page.locator("nav a[href=\"#reading\"]").click()
  assert.equal(await page.getByRole("button", { name: "Test and save", exact: true }).isVisible(), false)
  await page.goBack()
  assert.equal(await page.getByLabel("Model", { exact: true }).inputValue(), "second-model")
  await page.getByLabel("Model", { exact: true }).fill("manual-model")
  const unsaved = await storedConfig(context)
  assert.equal(unsaved.providersConfig.find(p => p.id === unsaved.translate.providerId).model, "fake-model")
  await page.getByRole("button", { name: "Test and save", exact: true }).click()
  await page.getByText("Connected", { exact: true }).waitFor()
  const config = await storedConfig(context)
  assert.equal(config.providersConfig.find(p => p.id === config.translate.providerId).model, "manual-model")
})

async function recordShortcut(page, label, combination) {
  await page.getByLabel(label, { exact: true }).click()
  await page.keyboard.press(combination)
  await page.getByLabel(label, { exact: true }).blur()
}

it("updates hover and page shortcuts live, switches display mode and toggles captions locally", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.locator("nav a[href=\"#features\"]").click()
  await page.getByRole("switch", { name: "Hover translation", exact: true }).click()
  await page.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  await page.locator("nav a[href=\"#shortcut\"]").click()
  await page.getByLabel("Hover translation trigger", { exact: true }).selectOption("control")
  await recordShortcut(page, "Translate this page / Show original", "Alt+P")
  await recordShortcut(page, "Switch bilingual / translation only", "Alt+M")
  await recordShortcut(page, "Toggle video subtitles", "Alt+V")
  const config = await storedConfig(context)
  assert.equal(config.features.hoverHotkey, "control")
  assert.equal(config.features.modeShortcut, "Alt+M")
  assert.equal(config.features.subtitlesShortcut, "Alt+V")
  await article.bringToFront()
  const paragraph = article.locator("p").first()
  await paragraph.hover()
  await article.keyboard.down("Control")
  await article.waitForTimeout(650)
  await article.keyboard.up("Control")
  await article.locator(".jiandao-translated-block-content").waitFor({ timeout: 15_000 })
  assert.equal(await article.locator(".jiandao-translated-block-content").count(), 1)
  await article.locator("body").click()
  await article.keyboard.press("Alt+P")
  await article.waitForFunction(() => document.querySelectorAll(".jiandao-translated-block-content").length === 5)
  await article.keyboard.press("Alt+M")
  await article.waitForFunction(() => [...document.querySelectorAll("h1, p")].every(el => el.textContent.trim().startsWith("【译】")))
  await article.keyboard.press("Alt+M")
  await article.waitForFunction(() => [...document.querySelectorAll("h1, p")].every(el => !el.textContent.trim().startsWith("【译】")))
  await article.evaluate(() => {
    const player = document.createElement("div")
    player.className = "html5-video-player"
    player.innerHTML = "<video style=\"width:640px;height:360px\"></video><div class=\"ytp-caption-window-container\"><span class=\"ytp-caption-segment\">Reading matters.</span></div>"
    document.body.prepend(player)
  })
  await article.locator("[data-reading-subtitles]").waitFor()
  await article.keyboard.press("Alt+V")
  await article.locator("[data-reading-subtitles]").waitFor({ state: "detached" })
  assert.notEqual(await article.locator(".ytp-caption-window-container").evaluate(el => getComputedStyle(el).visibility), "hidden")
  assert.equal((await storedConfig(context)).features.videoSubtitles, true)
  await article.keyboard.press("Alt+V")
  await article.locator("[data-reading-subtitles]").waitFor()
  await page.screenshot({ path: "/tmp/reading-shortcut-settings.png", fullPage: true })
})

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
  await page.locator("nav a[href=\"#backup\"]").click()
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
  await page.locator("nav a[href=\"#service\"]").click()
  await page.getByRole("button", { name: "Manual setup", exact: true }).click()
  await page.screenshot({ path: "/tmp/reading-manual-settings.png", fullPage: true })
})

it("hover translates and restores one paragraph without enabling whole-page translation", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.locator("nav a[href=\"#features\"]").click()
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
  await page.locator("nav a[href=\"#features\"]").click()
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
