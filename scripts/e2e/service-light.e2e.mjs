/* global chrome -- page.evaluate() reads only the isolated extension test profile. */
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, pressTranslateShortcut, reportFailure, storedConfig } from "./browser.mjs"
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

async function screenshot(page, name) {
  if (!process.env.SETTINGS_ARTIFACTS)
    return
  await mkdir(process.env.SETTINGS_ARTIFACTS, { recursive: true })
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))))
  await page.screenshot({ path: join(process.env.SETTINGS_ARTIFACTS, `${name}.png`), fullPage: true })
}

async function fitsViewport(page) {
  const overflow = await page.locator("#service input, #service textarea, #service button, #service summary").evaluateAll(controls => controls
    .filter(control => control.getClientRects().length)
    .filter((control) => {
      const rect = control.getBoundingClientRect()
      return rect.left < 0 || rect.right > innerWidth
    })
    .map(control => control.getAttribute("aria-label") ?? control.textContent))
  assert.deepEqual(overflow, [], "service controls fit the viewport")
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
}

function serviceRow(section, name) {
  return section.locator(".settings-service-row").filter({ has: section.page().getByRole("heading", { name, exact: true }) })
}

async function action(section, name, label) {
  const row = serviceRow(section, name)
  await row.locator("summary").click()
  await row.getByRole("button", { name: label, exact: true }).click()
}

async function savedEditor(section, label) {
  await section.getByRole("button", { name: label, exact: true }).click()
  await section.locator(".settings-service-editor").waitFor({ state: "detached", timeout: 15_000 })
}

async function translatedArticle(path = "/article") {
  const article = await context.newPage()
  await article.goto(`${service.origin}${path}`)
  await pressTranslateShortcut(article)
  await article.locator(".readomi-translated-block-content").nth(4).waitFor({ timeout: 20_000 })
  return article
}

it("manages independent services and switches future translations from the popup while preserving existing translations", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await page.setViewportSize({ width: 1280, height: 960 })
  const setup = setupDocumentFor(service.origin)
  await configureService(page, extensionId, setup)
  const section = page.locator("#service")
  const initial = await storedConfig(context)
  const active = initial.providersConfig.find(provider => provider.id === initial.translate.providerId)
  assert.ok(active?.connectionCheck?.ok)
  assert.equal(await section.locator(".settings-service-row").count(), 1)
  assert.equal(await section.locator(".settings-service-editor").count(), 0)
  await screenshot(page, "service-multi-default")

  // The current service remains selected until the reader chooses another one.
  const currentRow = serviceRow(section, active.name)
  await currentRow.locator("summary").click()
  assert.equal(await currentRow.getByRole("button", { name: "Use this service", exact: true }).isDisabled(), true)
  assert.equal(await currentRow.getByRole("button", { name: "Remove service", exact: true }).isDisabled(), true)
  assert.equal(await currentRow.getByRole("button", { name: "Remove service", exact: true }).getAttribute("title"), "Switch to another service first")

  const requestsBeforeTest = service.completions().length
  const release = service.holdAnswers()
  try {
    await currentRow.getByRole("button", { name: "Test connection", exact: true }).click()
    await currentRow.getByText("Testing…", { exact: true }).waitFor()
  }
  finally {
    release()
  }
  await page.waitForFunction(async ({ id, checkedAt }) => {
    const config = (await chrome.storage.local.get("config")).config
    return config.providersConfig.find(provider => provider.id === id)?.connectionCheck?.checkedAt > checkedAt
  }, { id: active.id, checkedAt: active.connectionCheck.checkedAt })
  await currentRow.getByText("Connected", { exact: true }).waitFor()
  const tested = await storedConfig(context)
  assert.deepEqual(tested, {
    ...initial,
    providersConfig: initial.providersConfig.map(provider => provider.id === active.id ? { ...provider, connectionCheck: tested.providersConfig.find(provider => provider.id === active.id).connectionCheck } : provider),
  }, "testing updates only the service's connection result")
  assert.equal(service.completions().length, requestsBeforeTest + 1)
  assert.equal(JSON.parse(service.completions().at(-1).body).model, active.model)

  // Two models at the same endpoint are independent services; adding leaves the selection alone.
  await section.getByRole("button", { name: "Add service", exact: true }).click()
  await section.getByRole("button", { name: "Agent setup", exact: true }).click()
  const editor = section.getByLabel("Translation service configuration", { exact: true })
  const secondDocument = setupDocumentFor(service.origin, { name: "Second gateway", model: "second-model" })
  await editor.fill(JSON.stringify(secondDocument, null, 2))
  assert.equal(await section.getByRole("checkbox", { name: "Use this service after adding", exact: true }).isChecked(), false)
  await savedEditor(section, "Check and add")
  let saved = await storedConfig(context)
  const second = saved.providersConfig.find(provider => provider.name === secondDocument.name)
  assert.ok(second && second.id !== active.id)
  assert.equal(second.baseURL, active.baseURL)
  assert.equal(saved.translate.providerId, active.id)
  assert.deepEqual(saved.providersConfig.find(provider => provider.id === active.id), tested.providersConfig.find(provider => provider.id === active.id))
  assert.equal(await section.locator(".settings-service-row").count(), 2)
  await screenshot(page, "service-multi-list")

  // Both editing methods target the inactive service's ID and retain its stored key.
  await action(section, second.name, "Edit")
  await section.getByRole("button", { name: "Agent setup", exact: true }).click()
  const document = JSON.parse(await editor.inputValue())
  assert.equal(document.model, second.model)
  assert.equal(document.apiKey, "…-key")
  assert.equal((await editor.inputValue()).includes(setup.apiKey), false)
  await editor.fill(JSON.stringify({ ...document, model: "agent-model" }, null, 2))
  await savedEditor(section, "Check and save")
  saved = await storedConfig(context)
  assert.equal(saved.translate.providerId, active.id)
  assert.equal(saved.providersConfig.find(provider => provider.id === second.id).model, "agent-model")
  assert.equal(saved.providersConfig.find(provider => provider.id === second.id).apiKey, setup.apiKey)

  await action(section, second.name, "Edit")
  await section.getByRole("button", { name: "Manual setup", exact: true }).click()
  assert.equal(await section.getByLabel("Model", { exact: true }).inputValue(), "agent-model")
  assert.equal(await section.getByLabel("API Key", { exact: true }).inputValue(), "")
  await section.getByLabel("Model", { exact: true }).fill("manual-model")
  await page.setViewportSize({ width: 390, height: 844 })
  await fitsViewport(page)
  await screenshot(page, "service-multi-mobile-manual")
  await savedEditor(section, "Check and save")
  saved = await storedConfig(context)
  assert.equal(saved.translate.providerId, active.id)
  assert.equal(saved.providersConfig.find(provider => provider.id === second.id).model, "manual-model")
  assert.equal(saved.providersConfig.find(provider => provider.id === second.id).apiKey, setup.apiKey)
  await fitsViewport(page)
  await screenshot(page, "service-multi-mobile-list")

  // A failed connection check retains the draft and never changes either saved service.
  await section.getByRole("button", { name: "Add service", exact: true }).click()
  await section.getByRole("button", { name: "Agent setup", exact: true }).click()
  const rejected = JSON.stringify(setupDocumentFor(service.origin, { name: "Rejected gateway", model: "rejected-model" }), null, 2)
  await editor.fill(rejected)
  await section.getByRole("button", { name: "Check and add", exact: true }).click()
  await section.getByText("Connection failed. Service was not added.", { exact: true }).waitFor({ timeout: 15_000 })
  assert.equal(await editor.inputValue(), rejected)
  assert.deepEqual(await storedConfig(context), saved)
  await fitsViewport(page)
  await screenshot(page, "service-multi-mobile-failed")
  await section.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 960 })

  const article = await translatedArticle()
  const existing = await article.locator(".readomi-translated-block-content").allTextContents()
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 320, height: 600 })
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  const trigger = popup.getByRole("button", { name: `Current service: ${active.name}. Switch service`, exact: true })
  await trigger.waitFor()
  await trigger.press("ArrowDown")
  const oldOption = popup.getByRole("menuitemradio", { name: new RegExp(active.name) })
  assert.equal(await oldOption.getAttribute("aria-checked"), "true")
  assert.equal(await oldOption.evaluate(element => element === document.activeElement), true)
  await oldOption.press("ArrowDown")
  const newOption = popup.getByRole("menuitemradio", { name: /Second gateway/ })
  assert.equal(await newOption.evaluate(element => element === document.activeElement), true)
  await screenshot(popup, "service-popup-open")
  const translationsBeforeSwitch = service.translationRequests().length
  await newOption.press("Enter")
  await popup.getByText("Switched to Second gateway", { exact: true }).waitFor()
  await serviceRow(section, second.name).locator(".settings-service-badge").waitFor()
  assert.equal((await storedConfig(context)).translate.providerId, second.id)
  assert.deepEqual(await article.locator(".readomi-translated-block-content").allTextContents(), existing)
  assert.equal(service.translationRequests().length, translationsBeforeSwitch, "switching keeps existing translations and sends no connection test")
  await screenshot(popup, "service-popup-switched")

  const requestsBeforeNextArticle = service.completions().length
  await translatedArticle("/article?selected-service=second")
  const futureRequests = service.completions().slice(requestsBeforeNextArticle)
  assert.ok(futureRequests.length > 0, "a new page uses the selected service")
  assert.ok(futureRequests.every(request => JSON.parse(request.body).model === "manual-model"), "future request payloads use the selected model")

  // Menu management opens the service settings; Escape returns focus to the footer.
  const newTrigger = popup.getByRole("button", { name: "Current service: Second gateway. Switch service", exact: true })
  await newTrigger.click()
  await popup.getByRole("menu", { name: "Switch service", exact: true }).press("Escape")
  assert.equal(await popup.getByRole("menu").count(), 0)
  assert.equal(await newTrigger.evaluate(element => element === document.activeElement), true)
  await newTrigger.click()
  const managedPage = context.waitForEvent("page")
  await popup.getByRole("menuitem", { name: "Manage services", exact: true }).click()
  const managed = await managedPage
  await managed.waitForURL(`chrome-extension://${extensionId}/options.html#service`)
  await managed.locator(".settings-service-row[data-current='true']").getByRole("heading", { name: second.name, exact: true }).waitFor()
  await managed.close()

  // Once the reader has switched, the previous service can be removed independently.
  await action(section, active.name, "Remove service")
  await serviceRow(section, active.name).waitFor({ state: "detached" })
  const final = await storedConfig(context)
  assert.equal(final.translate.providerId, second.id)
  assert.equal(final.providersConfig.some(provider => provider.id === active.id), false)
  assert.equal(final.providersConfig.find(provider => provider.id === second.id).model, "manual-model")
  await serviceRow(section, second.name).locator("summary").click()
  assert.equal(await serviceRow(section, second.name).getByRole("button", { name: "Remove service", exact: true }).isDisabled(), true)
})
