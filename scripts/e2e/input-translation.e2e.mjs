/* global chrome -- callback runs in the extension service worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure, waitForStoredConfig } from "./browser.mjs"
import { LANGUAGE_RULES_FIXTURES, setupDocumentFor, startFakeService } from "./fake-service.mjs"

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

async function spaces(page, selector, text, keyboard = page.keyboard) {
  const field = page.locator(selector)
  await field.fill(text)
  await field.press("End")
  for (let index = 0; index < 3; index++)
    await keyboard.press("Space")
}
async function value(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) => {
    const element = document.querySelector(selector)
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    return (element.isContentEditable ? element.innerText : element.value) === expected
  }, { selector, expected }, { timeout: 15000 }).catch(async (error) => {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(await page.locator(selector).evaluate(el => el.value ?? el.textContent))}`, { cause: error })
  })
}

it("replaces inputs and rich text with shared language rules, supports undo, preserves drafts and honors the settings switch", async () => {
  service = await startFakeService({ languageRules: true })
  const launched = await launchBrowser()
  context = launched.context
  const { page: settings, extensionId } = launched
  await configureService(settings, extensionId, setupDocumentFor(service.origin))
  const page = await context.newPage()
  await page.goto(`${service.origin}/article`)
  await page.evaluate(() => {
    document.body.innerHTML = "<input id=\"input\" aria-label=\"Input\"><textarea id=\"textarea\" aria-label=\"Draft\"></textarea><div id=\"rich\" contenteditable=\"true\" role=\"textbox\" aria-label=\"Rich draft\"></div><input id=\"password\" type=\"password\">"
    document.querySelector("#rich").style.cssText = "min-height:100px;border:1px solid black"
  })
  const { design, world, curious } = LANGUAGE_RULES_FIXTURES
  await spaces(page, "#textarea", design.en)
  await value(page, "#textarea", design.zh)
  await page.keyboard.press("ControlOrMeta+z")
  await value(page, "#textarea", `${design.en}  `)
  await spaces(page, "#input", curious.en)
  await value(page, "#input", curious.zh)
  await spaces(page, "#rich", world.en)
  await value(page, "#rich", world.zh)
  await page.keyboard.press("ControlOrMeta+z")
  // contenteditable may render terminal spaces as NBSP; compare visible prose.
  // eslint-disable-next-line unicorn/prefer-dom-node-text-content
  await page.waitForFunction(text => document.querySelector("#rich").innerText.trim() === text, world.en)

  const worker = context.serviceWorkers()[0]
  const setSecondary = async (code) => {
    await worker.evaluate(async (code) => {
      const { config } = await chrome.storage.local.get("config")
      config.language.secondaryCode = code
      await chrome.storage.local.set({ config })
    }, code)
    // Reading through the actual settings UI confirms the new storage value arrived.
    await settings.goto(`chrome-extension://${extensionId}/options.html#language`)
    await settings.getByRole("button", { name: "Second language", exact: true }).getAttribute("data-value").then(actual => assert.equal(actual, code))
  }
  await setSecondary("eng")
  await page.bringToFront()
  await spaces(page, "#textarea", world.zh)
  await value(page, "#textarea", world.en)
  for (const code of ["original", "cmn"]) {
    await setSecondary(code)
    await page.bringToFront()
    const before = service.translationRequests().length
    await spaces(page, "#textarea", world.zh)
    await page.waitForFunction(() => !document.querySelector(".readomi-input-pending"))
    assert.equal((await page.locator("#textarea").inputValue()).trim(), world.zh)
    assert.ok(service.translationRequests().length >= before)
  }

  // A held response must never overwrite a newer draft.
  const release = service.holdAnswers()
  try {
    await spaces(page, "#textarea", `${design.en} New draft.`)
    await page.locator(".readomi-input-pending").waitFor()
    await page.locator("#textarea").press("x")
    await page.locator(".readomi-input-pending").waitFor({ state: "detached" })
    const draft = await page.locator("#textarea").inputValue()
    release()
    // A subsequent fresh input waits for the held queue to finish as well.
    await spaces(page, "#input", design.en)
    await value(page, "#input", design.zh)
    assert.equal(await page.locator("#textarea").inputValue(), draft)
  }
  finally {
    release()
  }

  await settings.goto(`chrome-extension://${extensionId}/options.html#reading`)
  const toggle = settings.getByRole("switch", { name: "Input translation", exact: true })
  assert.equal(await toggle.getAttribute("aria-checked"), "true")
  await toggle.click()
  await waitForStoredConfig(context, config => config.features.inputTranslation === false)
  await page.bringToFront()
  const before = service.translationRequests().length
  await spaces(page, "#textarea", design.en)
  await value(page, "#textarea", `${design.en}   `)
  await spaces(page, "#password", "private password")
  assert.equal(await page.locator("#password").inputValue(), "private password   ")
  assert.equal(service.translationRequests().length, before)
})

it("keeps the pending indicator inside the input's bottom-right corner through resize, scrolling and layout shifts", async () => {
  service = await startFakeService({ languageRules: true })
  const launched = await launchBrowser()
  context = launched.context
  const { page: settings, extensionId } = launched
  await configureService(settings, extensionId, setupDocumentFor(service.origin))
  const page = await context.newPage()
  await page.goto(`${service.origin}/article`)
  await page.evaluate(() => {
    document.body.style.cssText = "margin:40px;transform:translate(25px,20px);min-height:2000px"
    document.body.innerHTML = "<div id=\"scroller\" style=\"height:240px;overflow:auto\"><div style=\"height:60px\"></div><textarea id=\"draft\" style=\"display:block;width:400px;height:140px\"></textarea><div style=\"height:500px\"></div></div>"
    // Host page styles must not add padding or margins to the indicator.
    const style = document.createElement("style")
    style.textContent = "span { margin:20px; padding:16px; min-width:60px; min-height:60px; }"
    document.head.append(style)
  })
  const release = service.holdAnswers()
  try {
    await spaces(page, "#draft", LANGUAGE_RULES_FIXTURES.design.en)
    await page.locator(".readomi-input-pending").waitFor()
    const assertCorner = async () => {
      await page.waitForFunction(() => {
        const input = document.querySelector("#draft").getBoundingClientRect()
        const indicator = document.querySelector(".readomi-input-pending")?.getBoundingClientRect()
        return indicator && Math.abs(input.right - indicator.right - 12) < 1 && Math.abs(input.bottom - indicator.bottom - 12) < 1
      }, undefined, { timeout: 5000 })
    }
    await assertCorner()
    await page.evaluate(() => document.querySelector("#draft").style.height = "180px")
    await assertCorner()
    await page.evaluate(() => document.querySelector("#scroller").scrollTop = 45)
    await assertCorner()
    await page.evaluate(() => document.querySelector("#scroller").style.marginTop = "90px")
    await assertCorner()
    await page.evaluate(() => window.scrollTo(0, 50))
    await assertCorner()
    release()
    await value(page, "#draft", LANGUAGE_RULES_FIXTURES.design.zh)
    assert.equal(await page.locator(".readomi-input-pending").count(), 0)
  }
  finally {
    release()
  }
})

it("replaces rich input in normal and late srcdoc iframes after page translation is enabled", async () => {
  service = await startFakeService({ languageRules: true })
  const launched = await launchBrowser()
  context = launched.context
  const { page: settings, extensionId } = launched
  await configureService(settings, extensionId, setupDocumentFor(service.origin))
  const page = await context.newPage()
  await page.goto(`${service.origin}/language-rules`)
  await page.evaluate((origin) => {
    const iframe = document.createElement("iframe")
    iframe.id = "normal-frame"
    iframe.src = `${origin}/language-rules?input-frame`
    document.body.append(iframe)
  }, service.origin)
  const normal = await (await page.locator("#normal-frame").elementHandle()).contentFrame()
  await normal.waitForURL("**/language-rules?input-frame")
  await page.bringToFront()
  await page.locator("h1").click()
  await page.keyboard.press("Alt+E")
  await normal.locator(".readomi-translated-block-content").first().waitFor({ timeout: 15000 })
  await normal.evaluate(() => {
    const editor = document.createElement("div")
    editor.id = "rich"
    editor.contentEditable = "true"
    editor.style.cssText = "min-height:80px;border:1px solid black"
    document.body.append(editor)
  })
  await spaces(normal, "#rich", LANGUAGE_RULES_FIXTURES.world.en, page.keyboard)
  await value(normal, "#rich", LANGUAGE_RULES_FIXTURES.world.zh)

  // This frame has an inherited origin and is reached by programmatic injection.
  await page.evaluate((prose) => {
    const iframe = document.createElement("iframe")
    iframe.id = "srcdoc-frame"
    iframe.srcdoc = `<p>${prose}</p><div id="rich" contenteditable="true" style="min-height:80px;border:1px solid black"></div>`
    document.body.append(iframe)
  }, LANGUAGE_RULES_FIXTURES.design.en)
  const srcdoc = await (await page.locator("#srcdoc-frame").elementHandle()).contentFrame()
  await srcdoc.waitForURL("about:srcdoc")
  await srcdoc.locator(".readomi-translated-block-content").first().waitFor({ timeout: 15000 })
  await spaces(srcdoc, "#rich", LANGUAGE_RULES_FIXTURES.curious.en, page.keyboard)
  await value(srcdoc, "#rich", LANGUAGE_RULES_FIXTURES.curious.zh)
  assert.equal(await srcdoc.locator(".readomi-input-pending").count(), 0)
})

it("discards a pending translation after blur to body and refocus on the same editor", async () => {
  service = await startFakeService({ languageRules: true })
  const launched = await launchBrowser()
  context = launched.context
  const { page: settings, extensionId } = launched
  await configureService(settings, extensionId, setupDocumentFor(service.origin))
  const page = await context.newPage()
  await page.goto(`${service.origin}/article`)
  await page.evaluate(() => {
    document.body.innerHTML = "<textarea id=\"draft\"></textarea><input id=\"next\">"
  })
  const release = service.holdAnswers()
  try {
    await spaces(page, "#draft", LANGUAGE_RULES_FIXTURES.world.en)
    await page.locator(".readomi-input-pending").waitFor()
    await page.evaluate(() => {
      const field = document.querySelector("#draft")
      field.blur()
      field.focus()
    })
    await page.locator(".readomi-input-pending").waitFor({ state: "detached" })
    const original = await page.locator("#draft").inputValue()
    release()
    // A later request completes behind the held one, ensuring its reply arrived.
    await spaces(page, "#next", LANGUAGE_RULES_FIXTURES.design.en)
    await value(page, "#next", LANGUAGE_RULES_FIXTURES.design.zh)
    assert.equal(await page.locator("#draft").inputValue(), original)
  }
  finally {
    release()
  }
})
