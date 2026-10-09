/* global chrome -- settings callbacks run in the extension page. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, pressTranslateShortcut, readClipboardWrites, reportFailure, storedConfig, trackClipboard } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service

async function assertEntryArrow(entry) {
  assert.equal(await entry.evaluate((row) => {
    const text = row.querySelector("div").getBoundingClientRect()
    const arrow = row.querySelector("svg").getBoundingClientRect()
    return arrow.left > text.right && Math.abs((arrow.top + arrow.bottom - text.top - text.bottom) / 2) < 2
  }), true, "the entry arrow stays to the right of the text and vertically centered")
}

afterEach(async (test) => {
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
  }
})

it("site rule labels survive a stale browser message catalog and the list adapts to wide and narrow windows", async () => {
  const launched = await launchBrowser()
  context = launched.context
  await context.addInitScript(() => {
    if (typeof chrome === "undefined" || !chrome.i18n)
      return
    const getMessage = chrome.i18n.getMessage.bind(chrome.i18n)
    chrome.i18n.getMessage = (key, ...args) => key.startsWith("siteRules_") ? "" : getMessage(key, ...args)
  })
  const settings = launched.page
  await settings.setViewportSize({ width: 2560, height: 1440 })
  await settings.goto(`chrome-extension://${launched.extensionId}/options.html#site-rules`)
  const section = settings.locator("#site-rules")
  await section.getByRole("heading", { name: "Site rules", exact: true }).waitFor()
  await settings.waitForURL("**/options.html#reading/site-rules")
  assert.equal(await settings.locator("nav a").count(), 9)
  assert.equal(await settings.locator("nav a[href='#reading']").getAttribute("aria-current"), "page")
  assert.equal(await settings.locator("nav a[href='#site-rules']").count(), 0)
  assert.equal(await settings.evaluate(() => chrome.i18n.getMessage("siteRules_title")), "", "the page is exercising the missing-native-message fallback")
  await section.getByRole("button", { name: "Rule details: readomi-preserve-text-defaults", exact: true }).waitFor()
  assert.equal(await section.getByRole("link", { name: "Read Frog", exact: true }).getAttribute("href"), "https://github.com/mengxi-ream/read-frog")
  assert.equal(await section.getByRole("link", { name: "GPL-3.0", exact: true }).getAttribute("href"), "https://github.com/mengxi-ream/read-frog/blob/main/LICENSE")
  assert.equal(await section.getByRole("switch").count(), 50)
  assert.ok((await section.boundingBox()).width <= 960, "the list stays readable on a wide screen")
  assert.equal(await section.getByRole("textbox", { name: "Custom site rules", exact: true }).isVisible(), false)
  await settings.setViewportSize({ width: 1280, height: 900 })
  await settings.screenshot({ path: "/tmp/readomi-site-rules-list.png" })
  await section.getByRole("button", { name: "Show more", exact: true }).click()
  assert.equal(await section.getByRole("switch").count(), 100)
  await section.getByRole("searchbox").fill("twitter.com")
  assert.equal(await section.getByRole("switch").count(), 1)
  const details = section.getByRole("button", { name: "Rule details: twitter", exact: true })
  await details.click()
  await trackClipboard(settings)
  await section.getByRole("button", { name: "Copy rule", exact: true }).click()
  await section.getByRole("button", { name: "Copied", exact: true }).waitFor()
  assert.equal(JSON.parse((await readClipboardWrites(settings)).at(-1)).id, "twitter")
  for (const width of [1280, 390]) {
    await settings.setViewportSize({ width, height: 900 })
    assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await section.getByRole("tab", { name: /Custom rules/ }).click()
  await section.getByRole("heading", { name: "No custom rules yet", exact: true }).waitFor()
  await section.locator(".site-rules-more > summary").click()
  await section.getByRole("button", { name: "Advanced JSON editing", exact: true }).click()
  await section.getByRole("heading", { name: "Edit custom rules", exact: true }).waitFor()
  await section.getByRole("button", { name: "Cancel", exact: true }).click()
  await section.getByRole("heading", { name: "No custom rules yet", exact: true }).waitFor()
  await section.getByRole("link", { name: "Back to Web reading", exact: true }).click()
  await settings.locator("#reading").getByRole("heading", { name: "Web reading", exact: true }).waitFor()
  assert.equal(await section.isVisible(), false)
  assert.equal(new URL(settings.url()).hash, "#reading")
  assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await settings.locator("#reading").getByRole("link", { name: "Site rules", exact: true }).click()
  await section.getByRole("heading", { name: "No custom rules yet", exact: true }).waitFor()
})

it("site rules persist through settings and control scope, display and stylesheet cleanup in a real page", async () => {
  service = await startFakeService({ streaming: true })
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await configureService(settings, launched.extensionId, setupDocumentFor(service.origin))
  await settings.setViewportSize({ width: 1280, height: 1000 })
  await settings.locator("nav a[href='#reading']").click()
  const reading = settings.locator("#reading")
  const section = settings.locator("#site-rules")
  await reading.getByRole("heading", { name: "Web reading", exact: true }).waitFor()
  assert.equal(await section.isVisible(), false, "the rules list stays hidden on the reading page")
  await assertEntryArrow(reading.getByRole("link", { name: "Site rules", exact: true }))
  await settings.screenshot({ path: "/tmp/readomi-reading-rules-entry.png", fullPage: true })
  await reading.getByRole("link", { name: "Site rules", exact: true }).click()
  await section.getByRole("heading", { name: "Site rules", exact: true }).waitFor()
  assert.equal(new URL(settings.url()).hash, "#reading/site-rules")
  await settings.goBack()
  await reading.getByRole("heading", { name: "Web reading", exact: true }).waitFor()
  assert.equal(await section.isVisible(), false)
  await settings.goForward()
  await section.getByRole("heading", { name: "Site rules", exact: true }).waitFor()
  assert.equal(await settings.locator("nav a[href='#reading']").getAttribute("aria-current"), "page")
  await section.getByRole("searchbox").fill("twitter.com")
  assert.equal(await section.getByRole("switch").count(), 1)
  const twitterToggle = section.getByRole("switch", { name: "Enable twitter", exact: true })
  await twitterToggle.click()
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.siteRules.disabledBuiltInRules.includes("twitter"))
  // Finish the queued write before reloading the settings document.
  await twitterToggle.and(section.locator(":enabled")).waitFor()
  await settings.reload()
  await section.getByRole("searchbox").fill("twitter.com")
  await settings.getByRole("switch", { name: "Enable twitter", exact: true, checked: false }).waitFor()
  await twitterToggle.click()
  await settings.waitForFunction(async () => !(await chrome.storage.local.get("config")).config.siteRules.disabledBuiltInRules.includes("twitter"))

  await section.getByRole("tab", { name: /Custom rules/ }).click()
  assert.equal(await section.getByRole("textbox", { name: "Custom site rules", exact: true }).isVisible(), false)
  await section.locator(".site-rules-more > summary").click()
  await section.getByRole("button", { name: "Advanced JSON editing", exact: true }).click()
  const editor = section.getByRole("textbox", { name: "Custom site rules", exact: true })
  await editor.fill("[{\"id\":\"example\",\"matches\":\"example.com\",\"forceBlockStyleSelector\":[]}]")
  await section.getByRole("alert").getByText("Invalid rule fields. Check the details below.", { exact: true }).waitFor()
  assert.equal(await section.getByRole("button", { name: "Save rules", exact: true }).isEnabled(), false)
  assert.deepEqual((await storedConfig(context)).siteRules.userRules, [])
  const rules = [{
    id: "fixture",
    matches: "site-rules.readomi.test",
    includeSelectors: ["#body p"],
    excludeSelectors: [".excluded"],
    forceBlockNodeSelectors: ["#body p"],
    forceBlockStyleSelectors: ["#body p"],
    preserveTextSelectors: ["#body a"],
    injectedCss: "#body p { outline: 2px solid rgb(182, 83, 62); }",
    minCharacters: 1,
    minWords: 1,
  }]
  await editor.fill(JSON.stringify(rules, null, 2))
  const saveRules = section.getByRole("button", { name: "Save rules", exact: true })
  await saveRules.click()
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.siteRules.userRules[0]?.id === "fixture")
  await section.locator(".site-rules-more > summary").waitFor({ state: "visible" })
  assert.equal(await editor.isVisible(), false)
  await settings.getByRole("link", { name: "Translation service", exact: true }).click()
  await settings.locator("nav a[href='#reading']").click()
  await reading.getByRole("link", { name: "Site rules", exact: true }).click()
  await section.locator(".site-rules-more > summary").click()
  await section.getByRole("button", { name: "Advanced JSON editing", exact: true }).click()
  assert.deepEqual(JSON.parse(await editor.inputValue()), rules)
  const draft = JSON.stringify([...rules, { id: "unfinished", matches: "example.com" }], null, 2)
  await editor.fill(draft)
  await section.getByRole("link", { name: "Back to Web reading", exact: true }).click()
  await reading.getByRole("heading", { name: "Web reading", exact: true }).waitFor()
  await reading.getByRole("link", { name: "Site rules", exact: true }).click()
  assert.equal(await editor.inputValue(), draft, "returning to reading keeps the unsaved rules draft")
  assert.deepEqual((await storedConfig(context)).siteRules.userRules, rules)
  await settings.screenshot({ path: "/tmp/readomi-site-rules-desktop.png", fullPage: true })
  await settings.setViewportSize({ width: 390, height: 900 })
  assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(await editor.isVisible(), true)
  await settings.screenshot({ path: "/tmp/readomi-site-rules-mobile.png", fullPage: true })
  await section.getByRole("link", { name: "Back to Web reading", exact: true }).click()
  await reading.getByRole("heading", { name: "Web reading", exact: true }).waitFor()
  assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await assertEntryArrow(reading.getByRole("link", { name: "Site rules", exact: true }))
  await settings.screenshot({ path: "/tmp/readomi-reading-rules-entry-mobile.png", fullPage: true })

  await context.route("https://site-rules.readomi.test/**", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Site rule fixture</title>
      <style>body{font:18px/1.6 system-ui;padding:32px;max-width:720px}p{margin:24px 0}</style>
      <h1>Site adaptation fixture</h1><nav><p>Menu must stay unchanged.</p></nav>
      <main id="body"><p id="source">Reading changes how we see the world. <a id="link" href="/source">Keep this link.</a></p>
      <p id="formula">The area of a circle is <span class="katex">πr²</span>.</p>
      <div class="excluded"><p id="excluded">Excluded ancestor stays untranslated.</p></div></main></html>`,
  }))
  const page = await context.newPage()
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.hoverTranslation = true
    config.features.hoverStream = true
    await chrome.storage.local.set({ config })
  })
  await page.goto("https://site-rules.readomi.test/article")
  const source = page.locator("#source")
  const original = await source.innerHTML()
  const outline = () => source.evaluate((node) => {
    const style = getComputedStyle(node)
    return { width: style.outlineWidth, style: style.outlineStyle }
  })
  const originalOutline = await outline()
  const formula = page.locator("#formula")
  const release = service.holdStreamCompletion()
  try {
    await formula.hover()
    await page.keyboard.press("Alt")
    await formula.locator(".readomi-spinner").waitFor({ state: "visible" })
    assert.equal(await page.locator("[data-readomi-inline-preview], [data-readomi-hover-preview]").count(), 0, "formula requests keep internal tokens out of streaming previews")
    assert.equal(await formula.textContent(), "The area of a circle is πr².")
  }
  finally {
    release()
  }
  await formula.locator(".readomi-translated-content-wrapper .katex").waitFor({ state: "visible" })
  assert.equal(await formula.locator(".readomi-translated-content-wrapper").textContent().then(text => /\{\{\d+\}\}/.test(text)), false)
  await formula.hover()
  await page.keyboard.press("Alt")
  await formula.locator(".readomi-translated-content-wrapper").waitFor({ state: "detached" })
  await pressTranslateShortcut(page)
  await source.locator(".readomi-translated-content-wrapper").waitFor({ state: "visible" })
  assert.equal(await page.locator("nav .readomi-translated-content-wrapper, #excluded .readomi-translated-content-wrapper").count(), 0)
  assert.equal(await page.locator("#link").getAttribute("href"), "/source")
  assert.equal(await page.locator("#link .readomi-translated-content-wrapper").count(), 0)
  assert.equal(await source.evaluate(node => getComputedStyle(node).outlineWidth), "2px")
  const translationBounds = await source.locator(".readomi-translated-block-content").boundingBox()
  const linkBounds = await page.locator("#link").boundingBox()
  assert.ok(translationBounds.y >= linkBounds.y + linkBounds.height, "block display places the translation below the original paragraph")
  await pressTranslateShortcut(page)
  await source.locator(".readomi-translated-content-wrapper").waitFor({ state: "detached" })
  assert.equal(await source.innerHTML(), original)
  assert.deepEqual(await outline(), originalOutline)
})
