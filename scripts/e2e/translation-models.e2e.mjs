/* global chrome -- storage reads and writes use only the isolated extension test profile. */
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, pressTranslateShortcut, reportFailure, storedConfig, waitForStoredConfig } from "./browser.mjs"
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
  }
})

it("selects independent page, hover and video models, persists them, and sends real requests to each model", async () => {
  service = await startFakeService({ streaming: true, models: ["page-model", "hover-model", "video-model"] })
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  const { extensionId } = launched
  await configureService(settings, extensionId, setupDocumentFor(service.origin, { name: "Page service", model: "page-model" }))
  const section = settings.locator("#service")
  for (const [name, model] of [["Hover service", "hover-model"], ["Video service", "video-model"]]) {
    await section.getByRole("button", { name: "Add service", exact: true }).click()
    await section.getByRole("button", { name: "Agent setup", exact: true }).click()
    await section.getByLabel("Translation service configuration").fill(JSON.stringify(setupDocumentFor(service.origin, { name, model })))
    await section.getByRole("button", { name: "Test and save", exact: true }).click()
    await section.locator(".settings-service-editor").waitFor({ state: "detached" })
  }
  await section.getByRole("tab", { name: "Model selection", exact: true }).click()
  const assignments = [["page", "Full-page translation", "Page service · page-model"], ["hover", "Hover paragraph translation", "Hover service · hover-model"], ["video", "Video subtitle translation", "Video service · video-model"]]
  for (const [task, name, option] of assignments) {
    await section.getByRole("combobox", { name, exact: true }).click()
    await settings.getByRole("option", { name: option, exact: true }).click()
    await waitForStoredConfig(context, config => config.translate.modelProviders[task] !== null)
  }
  const saved = await storedConfig(context)
  assert.equal(saved.providersConfig.find(provider => provider.id === saved.translate.providerId).model, "page-model")
  await settings.reload()
  for (const [, name, option] of assignments)
    assert.equal((await section.getByRole("combobox", { name, exact: true }).textContent()).trim(), option)

  // Visiting feature settings must not discard service drafts or duplicate model controls.
  await section.getByRole("tab", { name: "Service management", exact: true }).click()
  await section.getByRole("button", { name: "Edit Page service", exact: true }).click()
  await section.getByLabel("Model", { exact: true }).fill("unsaved-service-draft")
  await settings.locator(".options-navigation").getByRole("link", { name: "Web reading", exact: true }).click()
  assert.equal(await settings.locator("#reading a[href^='#service/models']").count(), 0)
  await settings.locator(".options-navigation").getByRole("link", { name: "Video subtitles", exact: true }).click()
  assert.equal(await settings.locator("#features a[href^='#service/models']").count(), 0)
  await settings.locator(".options-navigation").getByRole("link", { name: "Translation service", exact: true }).click()
  assert.equal(await section.getByLabel("Model", { exact: true }).inputValue(), "unsaved-service-draft")
  await section.getByRole("button", { name: "Cancel", exact: true }).click()

  const hoverRow = section.locator("article").filter({ hasText: "Hover service" })
  await hoverRow.locator("summary").click()
  assert.equal(await hoverRow.getByRole("button", { name: "Remove service", exact: true }).isEnabled(), false)

  // Set up unrelated feature preferences; all model assignments above were saved through the UI.
  const worker = context.serviceWorkers()[0]
  await worker.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.hoverTranslation = true
    config.features.hoverStream = true
    config.features.videoSubtitles = true
    config.translate.enableAIContentAware = false
    await chrome.storage.local.set({ config })
  })
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  const count = service.completions().length
  const paragraph = article.locator("p").first()
  await paragraph.hover()
  await article.keyboard.press("Alt")
  await article.locator(".readomi-translated-block-content").waitFor()
  const hoverRequests = service.completions().slice(count).map(request => JSON.parse(request.body))
  assert.ok(hoverRequests.some(request => request.model === "hover-model" && request.stream === true))
  assert.ok(hoverRequests.every(request => request.model === "hover-model"))
  // Switching the shared default must leave a fixed hover request running.
  await section.getByRole("radio", { name: "Video service · video-model", exact: true }).click()
  await waitForStoredConfig(context, config => config.providersConfig.find(provider => provider.id === config.translate.providerId)?.model === "video-model")
  await article.locator("p .readomi-translated-block-content:not(.preview-translation)").waitFor()
  // Reload the same text to verify that the hover cache does not bypass the page model.
  await article.reload()
  const beforePage = service.completions().length
  await pressTranslateShortcut(article)
  await article.waitForFunction(() => document.querySelectorAll(".readomi-translated-block-content").length >= 5)
  const pageRequests = service.completions().slice(beforePage).map(request => JSON.parse(request.body))
  assert.ok(pageRequests.length > 0)
  assert.ok(pageRequests.every(request => request.model === "page-model"))
  await pressTranslateShortcut(article)
  await article.waitForFunction(() => !document.querySelector(".readomi-translated-block-content"))
  const beforeVideo = service.completions().length
  await article.evaluate(() => {
    const player = document.createElement("div")
    player.className = "html5-video-player"
    player.innerHTML = "<video style=\"width:640px;height:360px\"></video><div class=\"ytp-caption-window-container\"><span class=\"ytp-caption-segment\">A separate video sentence.</span></div>"
    document.body.prepend(player)
  })
  await article.locator("[data-readomi-subtitles]").waitFor()
  const deadline = Date.now() + 15_000
  while (service.completions().length === beforeVideo && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 50))
  const videoRequests = service.completions().slice(beforeVideo).map(request => JSON.parse(request.body))
  assert.ok(videoRequests.length > 0)
  assert.ok(videoRequests.every(request => request.model === "video-model"))

  const popup = await context.newPage()
  await popup.setViewportSize({ width: 320, height: 600 })
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  for (const [task, ,] of assignments)
    await popup.getByRole("button", { name: new RegExp(`: ${task}-model, choose translation model$`) }).waitFor()
  const newOptionsPromise = context.waitForEvent("page")
  await popup.getByRole("button", { name: "Video subtitle translation: video-model, choose translation model", exact: true }).click()
  const newOptions = await newOptionsPromise
  await newOptions.waitForURL("**#service/models/video")
  await newOptions.waitForFunction(() => document.activeElement.id === "translation-model-video")
  await worker.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.ui.language = "zh-CN"
    config.appearance.mode = "light"
    await chrome.storage.local.set({ config })
  })
  await newOptions.getByRole("tab", { name: "模型选择", selected: true }).waitFor()
  await newOptions.setViewportSize({ width: 1280, height: 900 })
  const artifacts = resolve(".output/e2e-artifacts/translation-models")
  await mkdir(artifacts, { recursive: true })
  await newOptions.screenshot({ path: resolve(artifacts, "settings.png"), fullPage: true })
  await popup.getByRole("button", { name: "视频字幕翻译：video-model，选择翻译模型", exact: true }).waitFor()
  await popup.screenshot({ path: resolve(artifacts, "popup.png"), fullPage: true })
  await newOptions.setViewportSize({ width: 390, height: 844 })
  const fits = await newOptions.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth)
  assert.equal(fits, true, "model selectors fit narrow settings pages")
  await newOptions.screenshot({ path: resolve(artifacts, "mobile.png"), fullPage: true })
})
