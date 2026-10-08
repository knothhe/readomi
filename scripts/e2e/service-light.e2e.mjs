/* global chrome -- page.evaluate() reads only the isolated extension test profile. */
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
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
    context = undefined
    service = undefined
  }
})

async function screenshot(page, name) {
  if (!process.env.SETTINGS_ARTIFACTS)
    return
  await mkdir(process.env.SETTINGS_ARTIFACTS, { recursive: true })
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))))
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
  if (label === "Edit") {
    await row.getByRole("button", { name: `Edit ${name}`, exact: true }).click()
    return
  }
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
  assert.equal(await currentRow.getByRole("radio").getAttribute("aria-checked"), "true")
  assert.equal(await currentRow.getByRole("button", { name: "Remove service", exact: true }).isDisabled(), true)
  assert.equal(await currentRow.getByRole("button", { name: "Remove service", exact: true }).getAttribute("title"), "Switch to another service first")

  const requestsBeforeTest = service.completions().length
  const release = service.holdAnswers()
  try {
    await currentRow.getByRole("button", { name: "Test connection", exact: true }).click()
    await section.getByRole("status").filter({ hasText: "Testing…" }).waitFor()
  }
  finally {
    release()
  }
  await page.waitForFunction(async ({ id, checkedAt }) => {
    const config = (await chrome.storage.local.get("config")).config
    return config.providersConfig.find(provider => provider.id === id)?.connectionCheck?.checkedAt > checkedAt
  }, { id: active.id, checkedAt: active.connectionCheck.checkedAt })
  await section.getByRole("status").filter({ hasText: "Test passed" }).waitFor()
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
  await savedEditor(section, "Test and save")
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
  await savedEditor(section, "Test and save")
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
  await savedEditor(section, "Test and save")
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
  await section.getByRole("button", { name: "Test and save", exact: true }).click()
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
  await waitForStoredConfig(context, config => !config.providersConfig.some(provider => provider.id === active.id))
  const final = await storedConfig(context)
  assert.equal(final.translate.providerId, second.id)
  assert.equal(final.providersConfig.some(provider => provider.id === active.id), false)
  assert.equal(final.providersConfig.find(provider => provider.id === second.id).model, "manual-model")
  await serviceRow(section, second.name).locator("summary").click()
  assert.equal(await serviceRow(section, second.name).getByRole("button", { name: "Remove service", exact: true }).isDisabled(), true)
})

it("retains radio focus while saving and through consecutive keyboard service switches", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  const initial = await storedConfig(context)
  const first = initial.providersConfig[0]
  const second = { ...first, id: "keyboard-second", name: "Second gateway" }
  const third = { ...first, id: "keyboard-third", name: "Third gateway" }
  const requests = service.completions().length
  await context.serviceWorkers()[0].evaluate(config => chrome.storage.local.set({ config }), { ...initial, providersConfig: [first, second, third] })
  const section = page.locator("#service")
  const radio = name => serviceRow(section, name).getByRole("radio")
  await radio(third.name).waitFor()
  await page.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local)
    chrome.storage.local.set = async (...args) => {
      chrome.storage.local.set = original
      await new Promise((resolve) => {
        globalThis.releaseServiceSwitch = resolve
      })
      return original(...args)
    }
  })
  await radio(first.name).focus()
  await page.keyboard.press("ArrowDown")
  await page.waitForFunction(() => typeof globalThis.releaseServiceSwitch === "function")
  assert.equal(await radio(second.name).evaluate(element => element === document.activeElement), true, "pending saves keep radio focus")
  assert.equal(await radio(second.name).getAttribute("aria-disabled"), "true")
  assert.equal((await storedConfig(context)).translate.providerId, first.id, "the save is still pending")
  await page.evaluate(() => globalThis.releaseServiceSwitch())
  await waitForStoredConfig(context, config => config.translate.providerId === second.id)
  for (const [key, provider] of [["ArrowDown", third], ["Home", first], ["End", third]]) {
    await page.keyboard.press(key)
    await waitForStoredConfig(context, config => config.translate.providerId === provider.id)
    assert.equal(await radio(provider.name).evaluate(element => element === document.activeElement), true, `${key} keeps focus on the selected service`)
    assert.equal(await radio(provider.name).getAttribute("tabindex"), "0")
  }
  assert.equal(service.completions().length, requests, "keyboard service selection sends no translation requests")
})

it("reorders with mouse, keyboard and touch; locks pending saves and only reports failure", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await page.setViewportSize({ width: 1280, height: 960 })
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  const initial = await storedConfig(context)
  const active = initial.providersConfig[0]
  const second = { ...active, id: "sort-second", name: "Second gateway", model: "second-model" }
  const third = { ...active, id: "sort-third", name: "Third gateway", model: "third-model" }
  const configured = { ...initial, providersConfig: [active, second, third] }
  await context.serviceWorkers()[0].evaluate(config => chrome.storage.local.set({ config }), configured)
  const section = page.locator("#service")
  await section.getByRole("heading", { name: third.name, exact: true }).waitFor()
  const order = () => section.locator(".settings-service-row [role=heading]").allTextContents()
  const handle = name => section.getByRole("button", { name: `Reorder ${name}`, exact: true })
  const persistedOrder = expected => waitForStoredConfig(context, config => JSON.stringify(config.providersConfig.map(provider => provider.id)) === JSON.stringify(expected))

  await page.mouse.move(1200, 700)
  assert.equal(await handle(second.name).evaluate(element => getComputedStyle(element).opacity), "0")
  const beforeHover = await serviceRow(section, second.name).getByRole("radio").boundingBox()
  await serviceRow(section, second.name).hover()
  assert.equal(await handle(second.name).evaluate(element => getComputedStyle(element).opacity), "0.85")
  assert.deepEqual(await serviceRow(section, second.name).getByRole("radio").boundingBox(), beforeHover, "revealing the handle does not move the text")
  await screenshot(page, "service-sort-hover")

  // A mouse gesture previews only; releasing persists and keeps the current ID.
  const source = await handle(second.name).boundingBox()
  const destination = await serviceRow(section, active.name).boundingBox()
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2, destination.y + 8, { steps: 8 })
  assert.deepEqual(await order(), [second.name, active.name, third.name])
  assert.deepEqual((await storedConfig(context)).providersConfig.map(provider => provider.id), [active.id, second.id, third.id])
  await page.mouse.move(source.x + source.width / 2, destination.y + 36)
  await screenshot(page, "service-sort-dragging")
  await page.mouse.up()
  await persistedOrder([second.id, active.id, third.id])
  assert.equal((await storedConfig(context)).translate.providerId, active.id)
  assert.equal(await section.getByRole("alert").count(), 0)
  assert.equal(await section.locator(".settings-service-order-keyboard").count(), 0)
  await page.reload()
  await section.getByRole("heading", { name: third.name, exact: true }).waitFor()
  assert.deepEqual(await order(), [second.name, active.name, third.name], "the order survives reload")

  // Keyboard cancellation writes nothing and retains focus after moving DOM nodes.
  await handle(third.name).focus()
  await handle(third.name).press("Space")
  await handle(third.name).press("Home")
  assert.deepEqual(await order(), [third.name, second.name, active.name])
  assert.equal(await handle(third.name).evaluate(element => element === document.activeElement), true)
  await handle(third.name).press("Escape")
  assert.deepEqual(await order(), [second.name, active.name, third.name])
  assert.deepEqual((await storedConfig(context)).providersConfig.map(provider => provider.id), [second.id, active.id, third.id])

  // Hold the actual isolated-profile storage write to verify quiet locking.
  await page.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local)
    chrome.storage.local.set = async (...args) => {
      chrome.storage.local.set = original
      await new Promise((resolve) => {
        globalThis.releaseOrderSave = resolve
      })
      return original(...args)
    }
  })
  await handle(active.name).press("Space")
  await handle(active.name).press("Home")
  await handle(active.name).press("Space")
  await page.waitForFunction(() => typeof globalThis.releaseOrderSave === "function")
  assert.deepEqual(await order(), [active.name, second.name, third.name])
  for (const name of [active.name, second.name, third.name])
    assert.equal(await handle(name).isDisabled(), true)
  assert.equal(await section.getByRole("alert").count(), 0)
  assert.equal(await section.locator(".settings-service-order-keyboard").count(), 0)
  await screenshot(page, "service-sort-saving")
  await page.evaluate(() => {
    globalThis.releaseOrderSave()
  })
  await persistedOrder([active.id, second.id, third.id])
  await handle(active.name).waitFor({ state: "visible" })
  await page.waitForFunction(() => !document.querySelector(".settings-service-drag-handle").disabled)
  assert.equal(await section.getByRole("alert").count(), 0)

  // A rejected write rolls back and exposes one retry of the intended move.
  await page.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local)
    chrome.storage.local.set = async () => {
      chrome.storage.local.set = original
      throw new Error("E2E simulated order save failure")
    }
  })
  await handle(third.name).press("Space")
  await handle(third.name).press("Home")
  await handle(third.name).press("Space")
  await section.getByRole("alert").waitFor()
  assert.deepEqual(await order(), [active.name, second.name, third.name])
  await screenshot(page, "service-sort-failed")
  await section.getByRole("button", { name: "Retry", exact: true }).click()
  await persistedOrder([third.id, active.id, second.id])
  await section.getByRole("alert").waitFor({ state: "detached" })

  // Narrow touch entry remains discoverable without hover, and a real touch moves it.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.mouse.move(380, 700)
  assert.equal(await handle(second.name).evaluate(element => getComputedStyle(element).opacity), "0.48")
  await fitsViewport(page)
  const touchSource = await handle(second.name).boundingBox()
  const touchDestination = await serviceRow(section, third.name).boundingBox()
  const cdp = await context.newCDPSession(page)
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true })
  const x = touchSource.x + touchSource.width / 2
  const y = touchSource.y + touchSource.height / 2
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: touchDestination.y + 8 }] })
  await screenshot(page, "service-sort-mobile-dragging")
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await persistedOrder([second.id, third.id, active.id])
  assert.equal((await storedConfig(context)).translate.providerId, active.id)
  await fitsViewport(page)
  await screenshot(page, "service-sort-mobile-saved")
  await cdp.detach()

  if (process.env.SETTINGS_ARTIFACTS) {
    await page.setViewportSize({ width: 1280, height: 720 })
    await context.serviceWorkers()[0].evaluate(async (ids) => {
      const { config } = await chrome.storage.local.get("config")
      const names = ["DeepSeek", "Gemini", "Anthropic"]
      const models = ["deepseek-chat", "gemini-3.5-flash-lite", "claude-haiku-4-5"]
      await chrome.storage.local.set({ config: {
        ...config,
        ui: { ...config.ui, language: "zh-CN" },
        providersConfig: config.providersConfig.map((provider) => {
          const index = ids.indexOf(provider.id)
          return { ...provider, provider: ["deepseek", "gemini", "anthropic"][index], name: names[index], model: models[index] }
        }),
      } })
    }, [active.id, second.id, third.id])
    await section.getByRole("heading", { name: "Gemini", exact: true }).waitFor()
    await serviceRow(section, "Gemini").hover()
    await screenshot(page, "service-sort-zh-hover")
    await serviceRow(section, "DeepSeek").getByRole("button", { name: "修改 DeepSeek", exact: true }).click()
    await fitsViewport(page)
    await screenshot(page, "service-refined-zh-manual")
    await section.getByRole("button", { name: "agent 配置", exact: true }).click()
    await screenshot(page, "service-refined-zh-agent")
  }
})

it("shows test feedback only on request, keeps failures for retry and dismisses success after four seconds", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  const section = page.locator("#service")
  const initial = await storedConfig(context)
  const active = initial.providersConfig[0]
  await context.serviceWorkers()[0].evaluate(config => chrome.storage.local.set({ config }), { ...initial, providersConfig: [{ ...active, model: "rejected-model" }] })
  const notice = section.locator(".settings-service-notice")
  await notice.waitFor({ state: "detached", timeout: 6000 })
  assert.equal(await section.getByText("Connected", { exact: true }).count(), 0)
  const release = service.holdAnswers()
  try {
    await action(section, active.name, "Test connection")
    await notice.filter({ hasText: "Testing…" }).waitFor()
  }
  finally {
    release()
  }
  const error = notice.filter({ hasText: "Test failed" })
  await error.waitFor()
  assert.ok(await error.locator(".settings-service-notice-description").textContent())
  await screenshot(page, "service-test-failed")
  await page.waitForTimeout(4500)
  assert.equal(await error.isVisible(), true, "failures remain until dismissed or retried")
  await context.serviceWorkers()[0].evaluate(config => chrome.storage.local.set({ config }), initial)
  await error.getByRole("button", { name: "Test again", exact: true }).click()
  const success = notice.filter({ hasText: "Test passed" })
  await success.waitFor()
  await screenshot(page, "service-test-passed")
  await page.mouse.move(100, 100)
  await section.getByRole("heading", { name: "Translation service", exact: true }).click()
  await success.waitFor({ state: "detached", timeout: 6000 })
  assert.equal(await section.getByText("Connected", { exact: true }).count(), 0)
  assert.equal((await storedConfig(context)).providersConfig[0].connectionCheck.ok, true)
})
