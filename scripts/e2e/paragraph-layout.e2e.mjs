/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, pressTranslateShortcut, reportFailure } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
let release
const fixtureURL = "https://openai.com/index/eu-text-provenance/"
// Reproduce the live article's single-span and link-containing paragraphs,
// without depending on the public site's content or a real translation service.
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Paragraph layout</title>
<style>body{max-width:720px;margin:40px auto;font:17px/27px Arial,sans-serif}p,li{margin-bottom:24px}span{white-space:normal}.actions{display:flex;gap:24px;margin-bottom:32px}button{font:inherit}</style></head><body>
<article id="article"><div class="actions"><a id="link" href="#article"><span>Read the full article</span></a><button id="button"><span>Share this article</span></button></div>
<h1 id="heading"><span>Our approach to EU text provenance rules</span></h1>
<p id="with-link"><a href="#article">Content provenance</a><span> helps people understand where content came from and how it was created or edited.</span></p>
<p id="single"><span id="single-source">The EU AI Act requires generative AI providers to make generated text identifiable in a machine-readable way.</span></p>
<p id="nested"><span><span>In our evaluations, textGrain matched or exceeded the performance of other approaches we tested.</span></span></p>
<ul><li id="item"><span>Starting today, API customers globally will be able to opt in to text watermarking for select models.</span></li></ul>
<p id="flex" style="display:flex"><span>A flex label remains in its existing layout.</span></p>
</article></body></html>`

afterEach(async (test) => {
  release?.()
  await reportFailure(test, context)
  await context?.close()
  await service?.close()
  release = undefined
})

async function setup(streaming = false) {
  service = await startFakeService({ streaming })
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  await context.serviceWorkers()[0].evaluate(async (streaming) => {
    const { config } = await chrome.storage.local.get("config")
    config.features.hoverTranslation = true
    config.features.hoverStream = streaming
    config.translate.enableAIContentAware = false
    config.translate.mode = "bilingual"
    config.translate.translationNodeStyle = { preset: "line", isCustom: false, customCSS: "" }
    await chrome.storage.local.set({ config })
  }, streaming)
  const page = await context.newPage()
  await page.route(fixtureURL, route => route.fulfill({ contentType: "text/html", body: fixture }))
  await page.goto(fixtureURL)
  return page
}

function borderWidth(locator) {
  return locator.evaluate(node => getComputedStyle(node).borderLeftWidth)
}

it("page translation gives complete paragraphs the same line style regardless of inline wrapping", async () => {
  const page = await setup()
  await pressTranslateShortcut(page)
  for (const id of ["heading", "with-link", "single", "nested", "item"]) {
    const source = page.locator(`#${id}`)
    const translation = source.locator(".readomi-translated-block-content")
    await translation.waitFor()
    assert.equal(await borderWidth(translation), "2px", `${id} has the chosen line style`)
    assert.equal(await source.locator(".readomi-translated-content-wrapper").count(), 1)
    assert.equal(await source.locator(".readomi-translated-inline-content").count(), 0)
  }
  for (const id of ["link", "button", "flex"]) {
    const translation = page.locator(`#${id} .readomi-translated-inline-content`)
    await translation.waitFor()
    assert.equal(await borderWidth(translation), "0px", `${id} remains inline`)
  }
  await page.screenshot({ path: "/tmp/readomi-paragraph-layout-ready.png", fullPage: true })
  await pressTranslateShortcut(page)
  await page.locator(".readomi-translated-content-wrapper").first().waitFor({ state: "detached" })
  assert.equal(await page.locator("#single-source").textContent(), "The EU AI Act requires generative AI providers to make generated text identifiable in a machine-readable way.")
})

it("single-span paragraph hover keeps the line style from streaming through completion", async () => {
  const page = await setup(true)
  release = service.holdStreamCompletion()
  const paragraph = page.locator("#single")
  const source = await paragraph.locator("#single-source").elementHandle()
  const originalText = await source.textContent()
  await paragraph.hover()
  await page.keyboard.press("Alt")
  const preview = page.locator("[data-readomi-inline-preview]")
  const streamed = preview.locator(".preview-translation")
  await streamed.getByText(/阅读和经历/).waitFor()
  assert.equal(await borderWidth(streamed), "2px")
  release()
  await preview.waitFor({ state: "detached" })
  const translation = paragraph.locator(".readomi-translated-block-content")
  await translation.getByText(/阅读和经历/).waitFor()
  assert.equal(await borderWidth(translation), "2px")
  assert.equal(await paragraph.locator(".readomi-translated-inline-content").count(), 0)
  await paragraph.hover()
  await page.keyboard.press("Alt")
  await translation.waitFor({ state: "detached" })
  assert.equal(await paragraph.textContent(), originalText)
  assert.equal(await source.evaluate(node => node === document.querySelector("#single-source")), true, "toggle preserves the original span")
})
