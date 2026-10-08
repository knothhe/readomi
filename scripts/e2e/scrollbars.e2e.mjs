/* global chrome -- writes affect only this isolated extension profile. */
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
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

function scrollState(element) {
  return {
    width: getComputedStyle(element).scrollbarWidth,
    color: getComputedStyle(element).scrollbarColor,
    overflow: element.scrollHeight > element.clientHeight,
    top: element.scrollTop,
  }
}

async function screenshot(page, name) {
  if (!process.env.SETTINGS_ARTIFACTS)
    return
  await mkdir(process.env.SETTINGS_ARTIFACTS, { recursive: true })
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))))
  await page.screenshot({ path: join(process.env.SETTINGS_ARTIFACTS, `${name}.png`), fullPage: true })
}

it("scrolls a long model list with the shared scrollbar and preserves keyboard selection, themes and high contrast", async () => {
  const models = Array.from({ length: 40 }, (_, index) => `gateway/model-${String(index).padStart(2, "0")}`)
  service = await startFakeService({ models })
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await page.setViewportSize({ width: 1280, height: 900 })
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  const section = page.locator("#service")
  await section.getByRole("button", { name: "Edit Local gateway", exact: true }).click()
  await section.getByRole("button", { name: "Fetch models", exact: true }).click()
  const picker = section.getByRole("combobox", { name: "Select a model", exact: true })
  await picker.click()
  const list = page.getByRole("listbox")
  let state = await list.evaluate(scrollState)
  assert.equal(state.width, "thin")
  assert.equal(state.overflow, true)
  assert.equal((await list.boundingBox()).height <= 260, true)
  await screenshot(page, "models-open")
  await list.hover()
  await page.mouse.wheel(0, 300)
  await page.waitForFunction(() => document.querySelector(".settings-select-menu").scrollTop > 0)
  await picker.press("End")
  state = await list.evaluate(scrollState)
  assert.ok(state.top > 0, "keyboard navigation reveals the last model")
  await picker.press("Enter")
  assert.equal(await section.getByLabel("Model", { exact: true }).inputValue(), models.at(-1))
  assert.equal((await storedConfig(context)).providersConfig[0].model, "fake-model", "choosing a model keeps the saved service intact")
  await picker.click()
  await page.emulateMedia({ colorScheme: "dark" })
  assert.equal((await list.evaluate(scrollState)).width, "thin")
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"))
  await screenshot(page, "models-dark")
  await page.emulateMedia({ forcedColors: "active" })
  state = await list.evaluate(scrollState)
  assert.equal(state.width, "auto")
  assert.equal(state.color, "auto")
  await picker.press("Home")
  await picker.press("ArrowDown")
  await picker.press("Enter")
  assert.equal(await section.getByLabel("Model", { exact: true }).inputValue(), models[1])
  await page.emulateMedia({ forcedColors: "none", colorScheme: "light" })
  await page.setViewportSize({ width: 390, height: 844 })
  await picker.click()
  const bounds = await list.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390)
  assert.equal((await list.evaluate(scrollState)).width, "thin")
  await screenshot(page, "models-mobile")
  await picker.press("Escape")

  // The same dropdown rule covers settings outside the translation service.
  await section.getByRole("combobox", { name: "Service type", exact: true }).click()
  assert.equal((await list.evaluate(scrollState)).width, "thin")
  await section.getByRole("combobox", { name: "Service type", exact: true }).press("Escape")

  await section.getByRole("button", { name: "Agent setup", exact: true }).click()
  const editor = section.getByLabel("Translation service configuration", { exact: true })
  await editor.fill(JSON.stringify({ ...setupDocumentFor(service.origin), body: { stop: models } }, null, 2))
  state = await editor.evaluate(scrollState)
  assert.equal(state.width, "thin")
  assert.equal(state.overflow, true)
  assert.ok(state.color.endsWith("rgba(0, 0, 0, 0)"), "the long-content track is transparent")
  const lightColor = state.color
  await page.emulateMedia({ colorScheme: "dark" })
  await page.waitForFunction(color => getComputedStyle(document.querySelector(".settings-service-document")).scrollbarColor !== color, lightColor)
  assert.notEqual((await editor.evaluate(scrollState)).color, lightColor)
  await page.emulateMedia({ forcedColors: "active" })
  assert.equal((await editor.evaluate(scrollState)).width, "auto")
  await page.emulateMedia({ forcedColors: "none", colorScheme: "light" })
  await screenshot(page, "long-config")
  await page.locator("nav a[href=\"#language\"]").click()
  await page.getByRole("button", { name: "Primary language", exact: true }).click()
  state = await page.getByRole("listbox").evaluate(scrollState)
  assert.equal(state.width, "thin")
  assert.equal(state.overflow, true)
  await page.getByRole("combobox").press("Escape")

  const initial = await storedConfig(context)
  await context.serviceWorkers()[0].evaluate(config => chrome.storage.local.set({ config }), {
    ...initial,
    providersConfig: Array.from({ length: 20 }, (_, index) => ({ ...initial.providersConfig[0], id: index ? `service-${index}` : initial.providersConfig[0].id, name: `Service ${index}` })),
  })
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 320, height: 600 })
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.getByRole("button", { name: "Current service: Service 0. Switch service", exact: true }).click()
  state = await popup.locator("[role=\"menu\"] .overflow-y-auto").evaluate(scrollState)
  assert.equal(state.width, "thin")
  assert.equal(state.overflow, true)
  await popup.getByRole("menu").press("End")
  assert.ok((await popup.locator("[role=\"menu\"] .overflow-y-auto").evaluate(scrollState)).top > 0)
  await screenshot(popup, "services-popup")
})
