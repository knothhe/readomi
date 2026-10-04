/* global chrome -- page.evaluate() reads only the isolated extension test profile. */
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

async function screenshot(page, name) {
  if (!process.env.SETTINGS_ARTIFACTS)
    return
  await mkdir(process.env.SETTINGS_ARTIFACTS, { recursive: true })
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))))
  await page.screenshot({ path: join(process.env.SETTINGS_ARTIFACTS, `${name}.png`), fullPage: true })
}

async function editorFits(page) {
  const overflow = await page.locator("#service input, #service textarea, #service button").evaluateAll(controls => controls
    .filter(control => control.getClientRects().length)
    .filter((control) => {
      const rect = control.getBoundingClientRect()
      return rect.left < 0 || rect.right > innerWidth
    })
    .map(control => control.getAttribute("aria-label") ?? control.textContent))
  assert.deepEqual(overflow, [], "service editor controls fit the viewport")
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
}

async function compactSummary(section) {
  await section.getByText("Connected", { exact: true }).waitFor()
  const actions = await section.getByRole("button").evaluateAll(buttons => buttons
    .filter(button => button.getClientRects().length)
    .map(button => button.textContent.trim()))
  assert.deepEqual(actions, ["Test connection", "Edit"], "the saved service exposes only its two primary actions")
  assert.equal(await section.locator(".settings-service-editor").count(), 0)
  assert.equal(await section.getByRole("button", { name: "Manual setup", exact: true }).isVisible(), false)
  assert.equal(await section.getByRole("button", { name: "Agent setup", exact: true }).isVisible(), false)
}

it("keeps the service compact until editing and preserves the saved connection through tests and canceled edits", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await page.setViewportSize({ width: 1280, height: 960 })
  const setup = setupDocumentFor(service.origin)
  await configureService(page, extensionId, setup)
  const section = page.locator("#service")
  const details = section.locator(".settings-service-details")
  const initial = await storedConfig(context)
  const active = initial.providersConfig.find(provider => provider.id === initial.translate.providerId)
  assert.ok(active?.connectionCheck?.ok, "the initial setup saves a successful connection check")
  const initialRequests = service.requests.length

  await compactSummary(section)
  assert.equal(await details.evaluate(element => element.open), false)
  assert.equal(await details.locator("dl").isVisible(), false)
  await screenshot(page, "service-light-default")
  await details.locator("summary").click()
  assert.equal(await details.evaluate(element => element.open), true)
  await details.locator("dl").waitFor()
  const connectionText = await details.textContent()
  assert.ok(connectionText.includes(active.provider))
  assert.ok(connectionText.includes("openai-chat"))
  assert.ok(connectionText.includes(active.baseURL))
  assert.ok(connectionText.includes("…-key"))
  assert.equal(connectionText.includes(setup.apiKey), false, "connection details show the masked key")
  await screenshot(page, "service-light-details")
  assert.equal(service.requests.length, initialRequests, "viewing saved connection information sends no request")
  assert.deepEqual(await storedConfig(context), initial, "viewing details does not write configuration")

  await page.reload()
  await compactSummary(section)
  assert.equal(await details.evaluate(element => element.open), false, "connection details start collapsed on reload")
  assert.equal(service.requests.length, initialRequests, "reopening the summary uses the saved result")

  const release = service.holdAnswers()
  try {
    await section.getByRole("button", { name: "Test connection", exact: true }).click()
    await section.getByText("Testing…", { exact: true }).waitFor()
    assert.equal(await section.getByRole("button", { name: "Test connection", exact: true }).isDisabled(), true)
  }
  finally {
    release()
  }
  await page.waitForFunction(async ({ id, checkedAt }) => {
    const config = (await chrome.storage.local.get("config")).config
    const check = config.providersConfig.find(provider => provider.id === id)?.connectionCheck
    return check?.ok && check.checkedAt > checkedAt
  }, { id: active.id, checkedAt: active.connectionCheck.checkedAt })
  await compactSummary(section)
  const tested = await storedConfig(context)
  const testedProvider = tested.providersConfig.find(provider => provider.id === active.id)
  assert.deepEqual(tested, {
    ...initial,
    providersConfig: initial.providersConfig.map(provider => provider.id === active.id ? { ...provider, connectionCheck: testedProvider.connectionCheck } : provider),
  }, "testing changes only the saved connection result, preserving the provider, model, key and other settings")
  assert.equal(service.requests.length, initialRequests + 1, "the explicit test sends one request")
  const request = service.completions().at(-1)
  assert.equal(request.authorization, `Bearer ${setup.apiKey}`)
  assert.equal(JSON.parse(request.body).model, setup.model)

  await section.getByRole("button", { name: "Edit", exact: true }).click()
  assert.equal(await section.getByRole("group", { name: "Configuration method", exact: true }).isVisible(), true)
  await section.getByLabel("Translation service configuration", { exact: true }).waitFor()
  await section.getByRole("button", { name: "Manual setup", exact: true }).click()
  await section.getByLabel("Model", { exact: true }).fill("unsaved-manual-model")
  await section.getByLabel("Name", { exact: true }).fill("Unsaved local service")
  await section.getByLabel("API Key", { exact: true }).fill("unsaved-local-key")
  await screenshot(page, "service-light-manual")
  await page.setViewportSize({ width: 390, height: 844 })
  await editorFits(page)
  await screenshot(page, "service-light-mobile-manual")
  await section.getByRole("button", { name: "Cancel", exact: true }).click()
  await compactSummary(section)
  assert.deepEqual(await storedConfig(context), tested, "canceling manual edits keeps the complete saved configuration")

  await section.getByRole("button", { name: "Edit", exact: true }).click()
  const editor = section.getByLabel("Translation service configuration", { exact: true })
  await editor.waitFor()
  const document = JSON.parse(await editor.inputValue())
  assert.equal(document.apiKey, "…-key")
  assert.equal(document.model, setup.model)
  assert.equal((await editor.inputValue()).includes(setup.apiKey), false)
  assert.equal(await section.getByRole("button", { name: "Agent setup", exact: true }).getAttribute("aria-pressed"), "true")
  await editor.fill(JSON.stringify({ ...document, model: "unsaved-agent-model" }, null, 2))
  await editorFits(page)
  assert.ok(await editor.evaluate(element => element.getBoundingClientRect().height) >= 190, "the configuration editor has enough room to read the document")
  const footer = section.locator(".settings-service-edit-actions")
  const cancel = await footer.getByRole("button", { name: "Cancel", exact: true }).boundingBox()
  const apply = await footer.getByRole("button", { name: "Apply", exact: true }).boundingBox()
  assert.equal(cancel.y, apply.y, "mobile editing keeps Cancel and Apply together below the copy action")
  assert.ok(apply.x > cancel.x)
  await screenshot(page, "service-light-mobile-agent")
  await page.setViewportSize({ width: 1280, height: 960 })
  await screenshot(page, "service-light-agent")
  await section.getByRole("button", { name: "Cancel", exact: true }).click()
  await compactSummary(section)
  assert.deepEqual(await storedConfig(context), tested, "canceling a masked agent document keeps the saved configuration")
  assert.equal(service.requests.length, initialRequests + 1, "opening and canceling either editor makes no service request")
})
