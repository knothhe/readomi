/* global chrome -- configuration callbacks run in the extension worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
let releaseAnswers
let releaseStream

afterEach(async (test) => {
  releaseAnswers?.()
  releaseStream?.()
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
    context = undefined
    service = undefined
    releaseAnswers = undefined
    releaseStream = undefined
  }
})

// A host routes printable keys into an editor; claimed repeat triggers must
// remain ours while the same paragraph is waiting or streaming.
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title></title>
<style>body{max-width:640px;margin:40px auto;font:16px/1.6 Arial,sans-serif}p{margin:24px 0}textarea{width:100%;min-height:60px}</style></head><body>
<h1>The art of reading</h1>
<p id="first">Reading and experience train your model of the world. Each new idea becomes part of how you understand what comes next.</p>
<p id="second">Even if you forget what you read, the experience remains.</p>
<p id="third">A linked idea can change the way you see the world.</p>
<textarea aria-label="Message"></textarea><script>
window.siteKeys = []
document.addEventListener("keydown", event => {
  if (event.key === String.fromCharCode(96)) {
    window.siteKeys.push(event.key)
    document.querySelector("textarea").focus()
  }
}, true)
</script></body></html>`

async function setup(mode, streaming) {
  service = await startFakeService({ streaming })
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  // Service setup uses the real UI; these existing preferences are fixture
  // preparation, since this regression exercises paragraph triggers.
  await context.serviceWorkers()[0].evaluate(async ({ mode, streaming }) => {
    const { config } = await chrome.storage.local.get("config")
    config.features.hoverTranslation = true
    config.features.hoverHotkey = "backtick"
    config.features.hoverStream = streaming
    config.translate.mode = mode
    config.translate.enableAIContentAware = false
    await chrome.storage.local.set({ config })
  }, { mode, streaming })
  const url = `${service.origin}/hover-concurrent`
  await context.route(url, route => route.fulfill({ contentType: "text/html", body: fixture }))
  const page = await context.newPage()
  await page.goto(url)
  await page.bringToFront()
  return page
}

async function trigger(page, paragraph) {
  const preview = paragraph.locator("[data-readomi-inline-preview]")
  if (await preview.isVisible())
    await preview.hover()
  else
    await paragraph.hover()
  await page.keyboard.press("Backquote")
}
function sourceSegments(baseline) {
  return service.messages().slice(baseline).flatMap((messages) => {
    const user = [...messages].reverse().find(message => message.role === "user").content
    const source = user.match(/<(readomi_source_\d+)>\n([\s\S]*)\n<\/\1>/)?.[2] ?? user
    return source.split(/\r?\n[ \t]*%%[ \t]*\r?\n/)
  })
}
async function waitForRequests(baseline, originals) {
  const deadline = Date.now() + 10_000
  while (!originals.every(original => sourceSegments(baseline).some(segment => segment.includes(original))) && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 30))
  for (const original of originals)
    assert.equal(sourceSegments(baseline).filter(segment => segment.includes(original)).length, 1, "each paragraph is requested once, including when the backend batches them")
}

for (const mode of ["bilingual", "translationOnly"]) {
  for (const streaming of [true, false]) {
    it(`${mode} with streaming ${streaming} accepts two paragraphs and restores each independently`, async () => {
      const page = await setup(mode, streaming)
      const first = page.locator("#first")
      const second = page.locator("#second")
      const originals = [await first.innerHTML(), await second.innerHTML()]
      const sourceTexts = [await first.textContent(), await second.textContent()]
      const baseline = service.completions().length
      releaseAnswers = service.holdAnswers()
      if (streaming)
        releaseStream = service.holdStreamCompletion()
      await trigger(page, first)
      await first.locator(".readomi-spinner").waitFor({ state: "visible" })
      await trigger(page, second)
      await second.locator(".readomi-spinner").waitFor({ state: "visible" })
      await trigger(page, first)
      await trigger(page, second)
      await waitForRequests(baseline, sourceTexts)
      assert.equal(await page.locator(".readomi-spinner:visible").count(), 2)
      assert.deepEqual(await page.evaluate(() => window.siteKeys), [])
      assert.equal(await page.locator("textarea").evaluate(node => node === document.activeElement), false)
      if (mode === "bilingual" && streaming)
        await page.screenshot({ path: "/tmp/readomi-hover-concurrent-waiting.png", fullPage: true })
      releaseAnswers()

      if (streaming) {
        for (const paragraph of [first, second])
          await paragraph.locator("[data-readomi-inline-preview]").getByText(/阅读和经历/).waitFor()
        await trigger(page, first)
        await trigger(page, second)
        assert.deepEqual(await page.evaluate(() => window.siteKeys), [], "even replacement preview text keeps ownership of repeated backtick")
        assert.equal(service.completions().length, baseline + 2, "repeated triggers never duplicate requests")
        assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 2)
        if (mode === "bilingual")
          await page.screenshot({ path: "/tmp/readomi-hover-concurrent-streaming.png", fullPage: true })
        releaseStream()
      }
      await page.waitForFunction(() => !document.querySelector("[data-readomi-inline-preview]"))
      for (const paragraph of [first, second])
        await paragraph.locator(".readomi-translated-content-wrapper").getByText(streaming ? /阅读和经历/ : /【译】/).waitFor()
      assert.equal(await page.locator(".readomi-spinner").count(), 0)
      assert.equal(await page.locator("#third .readomi-translated-content-wrapper").count(), 0)
      await trigger(page, first)
      await page.waitForFunction(original => document.querySelector("#first").innerHTML === original, originals[0])
      assert.equal(await second.locator(".readomi-translated-content-wrapper").count(), 1)
      await trigger(page, second)
      await page.waitForFunction(original => document.querySelector("#second").innerHTML === original, originals[1])
    })
  }
}

it("Escape cancels both streaming paragraphs and ignores late completion", async () => {
  const page = await setup("translationOnly", true)
  const first = page.locator("#first")
  const second = page.locator("#second")
  const originals = [await first.innerHTML(), await second.innerHTML()]
  releaseStream = service.holdStreamCompletion()
  for (const paragraph of [first, second]) {
    await trigger(page, paragraph)
    await paragraph.locator("[data-readomi-inline-preview]").getByText(/阅读和经历/).waitFor()
  }
  await page.keyboard.press("Escape")
  await page.waitForFunction(originals => document.querySelector("#first").innerHTML === originals[0]
    && document.querySelector("#second").innerHTML === originals[1], originals)
  releaseStream()
  // Observe the late stream termination to ensure no old renderer writes back.
  await page.waitForTimeout(800)
  assert.equal(await page.locator("[data-readomi-inline-preview], .readomi-spinner, .readomi-translated-content-wrapper").count(), 0)
  assert.equal(await first.innerHTML(), originals[0])
  assert.equal(await second.innerHTML(), originals[1])
})
