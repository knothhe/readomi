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

async function waitForSaved(predicate) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const config = await storedConfig(context)
    if (predicate(config))
      return config
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error("The selected setting was not saved")
}

async function selectSetting(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

async function editService(page) {
  const row = page.locator("#service .settings-service-row[data-current='true']")
  await row.locator("summary").click()
  await row.getByRole("button", { name: "Edit", exact: true }).click()
}

it("fetches models from the configured API and preserves drafts across sidebar and history navigation", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await editService(page)
  await page.getByRole("button", { name: "Manual setup", exact: true }).click()
  assert.equal(service.requests.filter(r => r.url === "/v1/models").length, 0)
  await page.getByRole("button", { name: "Fetch models", exact: true }).click()
  await selectSetting(page, "Select a model", "second-model")
  const request = service.requests.find(r => r.url === "/v1/models")
  assert.equal(request.authorization, "Bearer local-secret-key")
  await page.locator("nav a[href=\"#reading\"]").click()
  assert.equal(await page.getByRole("button", { name: "Check and save", exact: true }).isVisible(), false)
  await page.goBack()
  assert.equal(await page.getByLabel("Model", { exact: true }).inputValue(), "second-model")
  await page.getByLabel("Model", { exact: true }).fill("manual-model")
  const unsaved = await storedConfig(context)
  assert.equal(unsaved.providersConfig.find(p => p.id === unsaved.translate.providerId).model, "fake-model")
  await page.getByRole("button", { name: "Check and save", exact: true }).click()
  await page.locator("#service .settings-service-editor").waitFor({ state: "detached", timeout: 15_000 })
  await page.getByText("Connected", { exact: true }).waitFor()
  const config = await storedConfig(context)
  assert.equal(config.providersConfig.find(p => p.id === config.translate.providerId).model, "manual-model")
  const completionsAfterSave = service.completions().length
  await editService(page)
  await page.getByRole("button", { name: "Agent setup", exact: true }).click()
  const editor = page.getByLabel("Translation service configuration")
  const document = JSON.parse(await editor.inputValue())
  assert.equal(document.model, "manual-model", "agent setup opens the latest manually saved model")
  assert.equal(document.apiKey, "…-key", "the stored key is masked")
  await page.getByRole("button", { name: "Copy instructions for your agent", exact: true }).waitFor()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await editService(page)
  await page.getByRole("button", { name: "Agent setup", exact: true }).click()
  await editor.waitFor()
  const agentButton = page.getByRole("button", { name: "Agent setup", exact: true })
  await agentButton.evaluate(button => Promise.all(button.getAnimations().map(animation => animation.finished)))
  assert.equal(await agentButton.getAttribute("aria-pressed"), "true")
  assert.notEqual(
    await agentButton.evaluate(button => getComputedStyle(button).backgroundColor),
    await page.getByRole("button", { name: "Manual setup", exact: true }).evaluate(button => getComputedStyle(button).backgroundColor),
    "the active setup method is visibly selected",
  )
  assert.equal(service.completions().length, completionsAfterSave, "reopening agent setup makes no connection request")
  assert.deepEqual(await storedConfig(context), config)
  await page.screenshot({ path: "/tmp/readomi-agent-setup-reopened.png", fullPage: true })
})

async function recordShortcut(page, label, combination) {
  await page.getByLabel(label, { exact: true }).click()
  await page.keyboard.press(combination)
  await page.getByLabel(label, { exact: true }).blur()
}

it("updates hover and page shortcuts live, switches display mode and toggles captions locally", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.locator("nav a[href=\"#reading\"]").click()
  await page.getByRole("switch", { name: "Hover translation", exact: true }).click()
  await page.locator("nav a[href=\"#features\"]").click()
  await page.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  await page.locator("nav a[href=\"#shortcut\"]").click()
  await selectSetting(page, "Hover translation trigger", "Control")
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
  await article.locator(".readomi-translated-block-content").waitFor({ timeout: 15_000 })
  assert.equal(await article.locator(".readomi-translated-block-content").count(), 1)
  // A tap restores the paragraph; switching to backtick works on the same page.
  await article.keyboard.press("Control")
  await article.locator(".readomi-translated-block-content").waitFor({ state: "detached" })
  await selectSetting(page, "Hover translation trigger", "Backtick (`)")
  await waitForSaved(config => config.features.hoverHotkey === "backtick")
  await waitForSaved(config => config.features.hoverHotkey === "backtick")
  assert.equal((await storedConfig(context)).features.hoverHotkey, "backtick")
  await article.bringToFront()
  await paragraph.hover()
  await article.keyboard.press("Backquote")
  await article.locator(".readomi-translated-block-content").waitFor({ timeout: 15_000 })
  // A hold restores it once, and releasing the held key must not translate it again.
  await paragraph.hover()
  await article.keyboard.down("Backquote")
  await article.locator(".readomi-translated-block-content").waitFor({ state: "detached" })
  await article.keyboard.up("Backquote")
  await article.waitForTimeout(600)
  assert.equal(await article.locator(".readomi-translated-block-content").count(), 0)
  await article.keyboard.press("Backquote")
  await article.locator(".readomi-translated-block-content").waitFor({ timeout: 15_000 })
  await article.locator("body").click()
  await article.keyboard.press("Alt+P")
  await article.waitForFunction(() => document.querySelectorAll(".readomi-translated-block-content").length === 5)
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
  await article.locator("[data-readomi-subtitles]").waitFor()
  await article.keyboard.press("Alt+V")
  await article.locator("[data-readomi-subtitles]").waitFor({ state: "detached" })
  assert.notEqual(await article.locator(".ytp-caption-window-container").evaluate(el => getComputedStyle(el).visibility), "hidden")
  assert.equal((await storedConfig(context)).features.videoSubtitles, true)
  await article.keyboard.press("Alt+V")
  await article.locator("[data-readomi-subtitles]").waitFor()
  await page.screenshot({ path: "/tmp/readomi-shortcut-settings.png", fullPage: true })
})

it("manual setup and local backup restore work without an account", async () => {
  const { page, extensionId } = await setUp()
  const doc = setupDocumentFor(service.origin)
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const manifest = JSON.parse(await readFile(new URL("../../.output/chrome-mv3/manifest.json", import.meta.url), "utf8"))
  await page.getByText(`Version ${manifest.version}`, { exact: true }).waitFor()
  await page.getByRole("button", { name: "Manual setup", exact: true }).click()
  await selectSetting(page, "Service type", "OpenAI-compatible service")
  await page.getByLabel("Name", { exact: true }).fill(doc.name)
  await page.getByLabel("API URL", { exact: true }).fill(doc.baseURL)
  await page.getByLabel("API Key", { exact: true }).fill(doc.apiKey)
  await page.getByLabel("Model", { exact: true }).fill(doc.model)
  await page.getByRole("button", { name: "Check and add", exact: true }).click()
  await page.locator("#service .settings-service-editor").waitFor({ state: "detached", timeout: 15_000 })
  await page.getByText("Connected", { exact: true }).waitFor()
  const saved = await storedConfig(context)
  await page.locator("nav a[href=\"#backup\"]").click()
  assert.equal(await page.locator("#backup").getByRole("button", { name: "Import", exact: true }).isVisible(), true)
  const downloadPromise = page.waitForEvent("download")
  await page.locator("#backup").getByRole("button", { name: "Export", exact: true }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), `readomi-config-v${manifest.version}.json`)
  const backup = JSON.parse(await readFile(await download.path(), "utf8"))
  assert.equal(backup.format, "readomi-config")
  assert.equal(backup.config.providersConfig.find(p => p.id === backup.config.translate.providerId).apiKey, doc.apiKey)
  backup.config.features.hoverTranslation = true
  await page.getByLabel("Import configuration", { exact: true }).setInputFiles({ name: "readomi-config.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole("button", { name: "Replace all settings", exact: true }).waitFor()
  assert.equal((await storedConfig(context)).features.hoverTranslation, false)
  await page.getByRole("button", { name: "Replace all settings", exact: true }).click()
  await page.getByText("Configuration imported.", { exact: true }).waitFor()
  const restored = await storedConfig(context)
  assert.equal(restored.features.hoverTranslation, true)
  assert.equal(restored.translate.providerId, saved.translate.providerId)
  assert.deepEqual(restored.providersConfig, saved.providersConfig.map(({ connectionCheck: _, ...provider }) => provider), "restoring the backup preserves service configuration, including the model and key")
  assert.ok(restored.providersConfig.every(provider => provider.connectionCheck === undefined), "restored services are untested because a backup does not establish connectivity")
  await page.locator("nav a[href=\"#service\"]").click()
  await page.locator("#service").getByText("Not checked", { exact: true }).waitFor()
  await page.getByRole("link", { name: "Web reading", exact: true }).click()
  await page.getByRole("switch", { name: "Hover translation", exact: true, checked: true }).waitFor()
  assert.equal(await page.getByRole("switch", { name: "Video subtitle translation", exact: true }).isVisible(), false)
  await page.screenshot({ path: "/tmp/readomi-web-reading.png", fullPage: true })
  await page.getByRole("link", { name: "Video subtitles", exact: true }).click()
  assert.equal(await page.getByRole("switch", { name: "Hover translation", exact: true }).isVisible(), false)
  const features = page.locator("#features")
  const custom = features.locator(".subtitle-custom")
  const presets = features.getByRole("group", { name: "Subtitle preset", exact: true })
  const modes = features.getByRole("group", { name: "Size mode", exact: true })
  assert.equal(await custom.evaluate(element => element.open), false)
  await modes.getByRole("button", { name: "Fixed size", exact: true }).click()
  await waitForSaved(config => config.features.subtitleStyle.fontSizeMode === "fixed")
  assert.equal(await custom.evaluate(element => element.open), false, "changing the main size mode does not open custom settings")
  await presets.getByRole("button", { name: "Focus", exact: true }).click()
  await waitForSaved(config => config.features.subtitleStyle.preset === "study")
  assert.equal(await custom.evaluate(element => element.open), false, "selecting a preset keeps fine controls collapsed")
  assert.deepEqual((await storedConfig(context)).features.subtitleStyle, {
    ...restored.features.subtitleStyle,
    preset: "study",
    fontSizeMode: "fixed",
    fontSize: 24,
    relativeFontSize: 6.25,
    backgroundEnabled: true,
    backgroundOpacity: 65,
  })
  await custom.locator("summary").click()
  const sizeSlider = features.getByRole("slider", { name: "Subtitle size", exact: true })
  const sizeNumber = features.getByRole("spinbutton", { name: "Subtitle size", exact: true })
  assert.equal(await sizeSlider.getAttribute("min"), "8")
  assert.equal(await sizeSlider.getAttribute("max"), "80")
  assert.equal(await sizeSlider.inputValue(), "24")
  await sizeSlider.press("End")
  await waitForSaved(config => config.features.subtitleStyle.fontSize === 80)
  await sizeSlider.blur()
  assert.equal(await sizeNumber.inputValue(), "80")
  assert.equal(await features.locator(".subtitle-preview-caption").evaluate(element => element.style.fontSize), "80px")
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: "/tmp/readomi-subtitle-settings.png", fullPage: true })
  await page.getByRole("link", { name: "Appearance", exact: true }).click()
  await page.getByRole("group", { name: "Appearance", exact: true }).getByRole("button", { name: "Dark", exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"))
  await page.getByRole("link", { name: "Video subtitles", exact: true }).click()
  await page.screenshot({ path: "/tmp/readomi-subtitle-settings-dark.png", fullPage: true })
  await presets.getByRole("button", { name: "Transparent", exact: true }).click()
  await features.getByRole("group", { name: "Common sizes", exact: true }).getByRole("button", { name: "20 px", exact: true }).click()
  await waitForSaved((config) => {
    const style = config.features.subtitleStyle
    return style.preset === "clear" && style.fontSizeMode === "fixed" && style.fontSize === 20 && style.backgroundOpacity === 0
  })
  assert.deepEqual((await storedConfig(context)).features.subtitleStyle, { ...restored.features.subtitleStyle, fontSizeMode: "fixed" })
  assert.equal(await presets.getByRole("button", { name: "Transparent", exact: true }).getAttribute("aria-pressed"), "true")
  assert.equal(await features.getByRole("slider", { name: "Background depth", exact: true }).inputValue(), "0")
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await features.evaluate(el => el.scrollWidth <= el.clientWidth), true)
  assert.equal(await sizeNumber.inputValue(), "20")
  assert.equal(await features.locator(".subtitle-preview-caption").evaluate(element => element.style.fontSize), "20px", "fixed pixels keep their size on mobile")
  await page.screenshot({ path: "/tmp/readomi-subtitle-settings-mobile.png", fullPage: true })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole("link", { name: "Appearance", exact: true }).click()
  await page.getByRole("group", { name: "Appearance", exact: true }).getByRole("button", { name: "Light", exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains("light"))
  await page.locator("nav a[href=\"#service\"]").click()
  await editService(page)
  await page.getByRole("button", { name: "Manual setup", exact: true }).click()
  await page.screenshot({ path: "/tmp/readomi-manual-settings.png", fullPage: true })
})

it("hover translates and restores one paragraph without enabling whole-page translation", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.getByRole("switch", { name: "Hover translation", exact: true }).click()
  await page.getByRole("switch", { name: "Hover translation", exact: true, checked: true }).waitFor()
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  await article.bringToFront()
  const paragraph = article.locator("p").first()
  await paragraph.hover()
  await article.keyboard.down("Alt")
  await article.waitForTimeout(650)
  await article.keyboard.up("Alt")
  await article.locator(".readomi-translated-block-content").waitFor({ timeout: 15_000 })
  assert.equal(await article.locator(".readomi-translated-block-content").count(), 1)
  assert.equal(await article.locator("h1 .readomi-translated-block-content").count(), 0)
  await paragraph.hover()
  await article.keyboard.down("Alt")
  await article.waitForTimeout(650)
  await article.keyboard.up("Alt")
  await article.locator(".readomi-translated-block-content").waitFor({ state: "detached" })
  // Turning the popup switch off stops hover translation on the existing tab.
  await page.getByRole("switch", { name: "Hover translation", exact: true }).click()
  await waitForSaved(config => !config.features.hoverTranslation)
  await article.bringToFront()
  await paragraph.hover()
  await article.keyboard.press("Alt")
  await article.waitForTimeout(600)
  assert.equal(await article.locator(".readomi-translated-block-content").count(), 0)
  assert.equal((await storedConfig(context)).features.hoverTranslation, false)
})

it("caption DOM translates locally and closing the feature restores the player", async () => {
  const { page, extensionId } = await setUp()
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  await page.getByRole("switch", { name: "Video subtitle translation", checked: true }).waitFor()
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  await article.evaluate(() => {
    const player = document.createElement("div")
    player.className = "html5-video-player"
    player.innerHTML = "<video style=\"width:640px;height:360px\"></video><div class=\"ytp-caption-window-container\"><span class=\"ytp-caption-segment\">Reading matters.</span></div>"
    document.body.prepend(player)
  })
  await article.locator("[data-readomi-subtitles]").waitFor()
  await article.waitForFunction(() => getComputedStyle(document.querySelector(".ytp-caption-window-container")).visibility === "hidden")
  const limit = Date.now() + 15_000
  while (!service.completions().some(r => r.body.includes("Reading matters."))) {
    assert.ok(Date.now() < limit, "subtitle text reached the configured local API")
    await article.waitForTimeout(100)
  }
  await page.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  await article.locator("[data-readomi-subtitles]").waitFor({ state: "detached" })
  assert.notEqual(await article.locator(".ytp-caption-window-container").evaluate(el => getComputedStyle(el).visibility), "hidden")
  assert.equal((await storedConfig(context)).features.videoSubtitles, false)
})
