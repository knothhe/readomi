/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
let release
let resume
afterEach(async (test) => {
  resume?.()
  release?.()
  await reportFailure(test, context)
  await context?.close()
  await service?.close()
})

const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><title>X timeline layout</title>
<style>body{margin:0;font:17px/24px Arial}main{width:600px;margin:24px auto}article{padding:20px;border:1px solid #eff3f4}.quote{padding:16px;border:1px solid #cfd9de;border-radius:16px;margin-top:16px}.text{display:block;white-space:pre-line}.clamped{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}.author{font-weight:bold;margin-bottom:8px}</style>
<main>
<article data-testid="tweet"><div class="author" data-testid="User-Name">DHH @dhh</div>
<div class="text" data-testid="tweetText"><span>We should thank our lucky stars that Linus is part of this conversation about the Linux world.</span></div>
<div class="quote"><div class="author" data-testid="User-Name">Phoronix @phoronix</div>
<div id="quote" class="text clamped" data-testid="tweetText" style="-webkit-line-clamp:5"><span>Linus Torvalds used AI to make code decipherable and uncovered more bugs.

More AI use on the Linux kernel this weekend.

Read the article for more details.

phoronix.com/news/example</span></div></div></article>
<article data-testid="tweet"><div class="author" data-testid="User-Name">Hsiaoming Yang @lepture</div>
<div id="target" class="text" data-testid="tweetText"><span id="source">The preview server can now be started, and scrolling in the editor also scrolls the preview page.</span></div></article>
<article data-testid="tweet"><div id="other" class="text clamped" style="-webkit-line-clamp:2"><span>Another collapsed paragraph.
Second visible line.
This third line stays hidden.</span></div>
<div id="card" data-testid="card.layoutSmall.detail"><div>Link preview</div><div class="clamped" style="-webkit-line-clamp:2">A card title.
Second visible line.
This third line stays hidden.</div></div></article>
</main></html>`

async function geometry(page) {
  return page.evaluate(() => Object.fromEntries(["quote", "target", "other", "card"].map((id) => {
    const node = document.getElementById(id)
    const rect = node.getBoundingClientRect()
    // Only the target's top is invariant: its own translation may grow below it.
    return [id, id === "target" ? { top: rect.top, left: rect.left } : { height: rect.height, width: rect.width }]
  })))
}

for (const mode of ["bilingual", "translationOnly"]) {
  for (const streaming of [false, true]) {
    it(`X hover ${mode}, streaming ${streaming}, preserves unrelated collapsed cards`, async () => {
      service = await startFakeService({ streaming })
      const launched = await launchBrowser()
      context = launched.context
      await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
      await context.serviceWorkers()[0].evaluate(async ({ mode, streaming }) => {
        const { config } = await chrome.storage.local.get("config")
        config.features.hoverTranslation = true
        config.features.hoverStream = streaming
        config.translate.mode = mode
        config.translate.enableAIContentAware = false
        await chrome.storage.local.set({ config })
      }, { mode, streaming })
      const page = await context.newPage()
      const url = `https://${streaming ? "x.com" : "twitter.com"}/home`
      await page.route(url, route => route.fulfill({ contentType: "text/html", body: fixture }))
      await page.goto(url)
      const before = await geometry(page)
      assert.equal(before.quote.height, 120, "the quote begins clamped to five lines")
      const original = await page.locator("#target").textContent()
      resume = service.holdAnswers()
      release = streaming ? service.holdStreamCompletion() : undefined
      await page.locator("#source").hover()
      await page.keyboard.press("Alt")
      await page.locator("#target .readomi-spinner").waitFor({ state: "visible" })
      assert.deepEqual(await geometry(page), before, "waiting does not expand another tweet")
      resume()
      if (streaming) {
        await page.locator("[data-readomi-inline-preview] .content").getByText(/阅读和经历/).waitFor()
        const during = await geometry(page)
        assert.deepEqual(during.quote, before.quote, "streaming keeps the upper quote collapsed")
        assert.deepEqual(during.other, before.other)
        assert.deepEqual(during.card, before.card)
        assert.deepEqual(during.target, before.target, "the source stays in its reading position")
        release()
        await page.locator("[data-readomi-inline-preview]").waitFor({ state: "detached" })
      }
      await page.locator("#target").getByText(streaming ? /阅读和经历/ : /【译】/).waitFor()
      const after = await geometry(page)
      assert.deepEqual(after.quote, before.quote)
      assert.deepEqual(after.other, before.other)
      assert.deepEqual(after.card, before.card)
      if (mode === "bilingual")
        assert.deepEqual(after.target, before.target, "completion keeps the original in place")
      await page.locator("#target").hover()
      await page.keyboard.press("Alt")
      await page.waitForFunction(text => document.querySelector("#target").textContent === text, original)
      assert.deepEqual(await geometry(page), before, "restoring returns to the original layout")
    })
  }
}
