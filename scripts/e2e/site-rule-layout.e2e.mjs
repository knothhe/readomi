/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

const sites = [
  ["Threads", "www.threads.com", "x569fbc"],
  ["Reddit", "www.reddit.com", "line-clamp-2"],
  ["Stack Overflow", "stackoverflow.com", "s-post-summary--content-excerpt"],
  ["GitHub", "github.com", "discussion-title"],
  ["Naver", "section.blog.naver.com", "text"],
  ["LinkedIn", "www.linkedin.com", "feed-shared-inline-show-more-text"],
  ["autoHeight", "engoo.com", "item-title"],
  ["overflow-sites", "www.uzh.ch", "TextImage--inner"],
  ["CurseForge", "www.curseforge.com", "description"],
]
let context
let service
let resume
let release
afterEach(async (test) => {
  resume?.()
  release?.()
  await reportFailure(test, context)
  await context?.close()
  await service?.close()
  context = service = resume = release = undefined
})

function fixture(name, className) {
  const card = className === "description"
    ? "class=\"card project-card\""
    : "class=\"card\""
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Site layout regression: ${name}</title>
  <style>body{margin:0;font:16px/24px Arial;overflow-y:auto}#shared{display:grid;grid-template-columns:380px 380px;gap:20px;align-items:start;width:800px;height:640px;margin:24px auto}.card{padding:12px;border:1px solid #ddd}.project-card{height:80px;overflow:hidden}p{margin:0;white-space:pre-line}.folded{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}.source{display:block;overflow:hidden}</style>
  <div id="shared" class="${className}">
  <div ${card}><p id="untouched" class="folded ${className}" style="max-height:48px;-webkit-line-clamp:2">First untouched line.
Second untouched line.
Third line stays folded.
Fourth line stays folded.</p></div>
  <div ${card}><p id="target" class="source ${className}" style="max-height:48px;text-overflow:ellipsis"><span id="source">${name}: keep this line.
Keep this second line intact.</span></p></div>
  <div ${card}><p id="other" class="folded ${className}" style="max-height:48px;-webkit-line-clamp:2">Another untouched card.
Its second line stays here.
The rest remains folded.</p></div></div></html>`
}

async function snapshot(page) {
  return page.evaluate(() => {
    const shape = (node) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return { width: rect.width, height: rect.height, display: style.display, fontSize: style.fontSize, lineHeight: style.lineHeight, whiteSpace: style.whiteSpace, overflow: style.overflow, clamp: style.webkitLineClamp }
    }
    const source = document.getElementById("source")
    const target = document.getElementById("target")
    const rect = target.getBoundingClientRect()
    return {
      untouched: shape(document.getElementById("untouched")),
      untouchedCard: shape(document.getElementById("untouched").parentElement),
      other: shape(document.getElementById("other")),
      otherCard: shape(document.getElementById("other").parentElement),
      shared: shape(document.getElementById("shared")),
      bodyOverflow: getComputedStyle(document.body).overflowY,
      targetTop: rect.top + scrollY,
      targetLeft: rect.left + scrollX,
      source: source
        ? (() => {
            const style = getComputedStyle(source)
            const range = document.createRange()
            range.selectNodeContents(source.firstChild)
            return {
              fontSize: style.fontSize, lineHeight: style.lineHeight, whiteSpace: style.whiteSpace,
              text: source.firstChild.textContent,
              lines: [...range.getClientRects()].map(rect => ({ width: rect.width, height: rect.height })),
            }
          })()
        : null,
    }
  })
}

function assertUntranslated(actual, expected, name) {
  for (const key of ["untouched", "untouchedCard", "other", "otherCard", "shared", "bodyOverflow", "targetTop", "targetLeft"])
    assert.deepEqual(actual[key], expected[key], `${name}: ${key} keeps its original layout`)
}

async function setup(mode, streaming) {
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
    // Limit extraction to the fixture's selected paragraph. The actual built-in
    // CSS still runs; this test isolates its layout contract from site discovery.
    config.siteRules.userRules = [{
      id: "layout-fixture", matches: "*://*/*", includeSelectors: ["#target"],
      forceBlockNodeSelectors: ["#target"], forceBlockStyleSelectors: ["#target"],
    }]
    await chrome.storage.local.set({ config })
  }, { mode, streaming })
  const page = await context.newPage()
  await page.setViewportSize({ width: 1200, height: 1100 })
  return page
}

for (const [mode, streaming] of [["bilingual", false], ["translationOnly", true]]) {
  it(`built-in layout isolation across nine sites: ${mode}, streaming ${streaming}`, async () => {
    const page = await setup(mode, streaming)
    for (const [name, host, className] of sites) {
      const url = `https://${host}/layout-regression`
      await page.route(url, route => route.fulfill({ contentType: "text/html", body: fixture(name, className) }))
      await page.goto(url)
      const before = await snapshot(page)
      assert.equal(before.untouched.height, 48)
      assert.equal(before.shared.height, 640)
      const original = await page.locator("#target").textContent()
      const originalStyle = await page.locator("#target").evaluate(node => node.style.cssText)
      resume = service.holdAnswers()
      release = streaming ? service.holdStreamCompletion() : undefined
      await page.locator("#source").hover()
      await page.keyboard.press("Alt")
      await page.locator("#target .readomi-spinner").waitFor({ state: "visible" })
      assertUntranslated(await snapshot(page), before, `${name} waiting`)
      assert.deepEqual((await snapshot(page)).source, before.source, `${name}: source typography stays intact`)
      resume()
      if (streaming) {
        await page.locator("[data-readomi-inline-preview] .content").getByText(/阅读和经历/).waitFor()
        assertUntranslated(await snapshot(page), before, `${name} streaming`)
        release()
        await page.locator("[data-readomi-inline-preview]").waitFor({ state: "detached" })
      }
      await page.locator("#target").getByText(streaming ? /阅读和经历/ : /【译】/).waitFor()
      assertUntranslated(await snapshot(page), before, `${name} completed`)
      if (mode === "bilingual")
        assert.deepEqual((await snapshot(page)).source, before.source)
      assert.ok(await page.locator("#target").evaluate(node => node.clientHeight >= node.scrollHeight - 1), `${name}: the target translation is not clipped`)
      assert.ok(await page.locator("#target").evaluate(node => node.parentElement.clientHeight >= node.parentElement.scrollHeight - 1), `${name}: the card shell does not clip the translation`)
      // The canonical wrapper appears before the preview's final height
      // animation has settled. Restore only after that visible transition ends.
      await page.waitForFunction(() => document.getElementById("target").getAnimations().every(animation => animation.playState !== "running"))
      await page.locator("#target").hover()
      await page.keyboard.press("Alt")
      await page.waitForFunction(text => document.getElementById("target").textContent === text, original)
      await page.locator("[data-readomi-layout-owner]").waitFor({ state: "detached" })
      assert.deepEqual(await snapshot(page), before, `${name}: restore returns the original geometry`)
      assert.equal(await page.locator("#target").evaluate(node => node.style.cssText), originalStyle)
    }
  })
}

it("cancellation and host removal release the layout boundary", async () => {
  const page = await setup("bilingual", true)
  const url = "https://www.threads.com/layout-cancel"
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: fixture("Cancel", "x569fbc") }))
  await page.goto(url)
  const before = await snapshot(page)
  release = service.holdStreamCompletion()
  await page.locator("#source").hover()
  await page.keyboard.press("Alt")
  await page.locator("[data-readomi-inline-preview] .content").getByText(/阅读和经历/).waitFor()
  await page.keyboard.press("Escape")
  await page.locator("[data-readomi-layout-owner]").waitFor({ state: "detached" })
  assert.deepEqual(await snapshot(page), before)
  release()
  // Completed wrappers can also be removed by the site's own rendering.
  await page.locator("#source").hover()
  await page.keyboard.press("Alt")
  await page.locator("#target").getByText(/阅读和经历/).waitFor()
  await page.locator("[data-readomi-inline-preview]").waitFor({ state: "detached" })
  await page.locator("#target .readomi-translated-content-wrapper").evaluate(node => node.remove())
  await page.locator("[data-readomi-layout-owner]").waitFor({ state: "detached" })
  assert.deepEqual(await snapshot(page), before)
})

it("a virtual-list shell stays hidden while its explicitly visible item is translated", async () => {
  const page = await setup("bilingual", false)
  const url = "https://community.ui.com/releases/layout-regression"
  await page.route(url, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><style>body{font:16px/24px Arial;margin:24px}p{margin:0}</style>
    <div id="shell" style="flex: 0 0 auto; position: relative; visibility: hidden; height:180px">
      Hidden shell text
      <div style="position: absolute; visibility: visible">
        <p id="target"><span id="source">A visible release announcement.</span></p>
      </div>
    </div><p id="hidden" style="visibility:hidden">Another hidden paragraph.</p></html>`,
  }))
  await page.goto(url)
  await page.locator("#source").hover()
  await page.keyboard.press("Alt")
  const translation = page.locator("#target .readomi-translated-block-content")
  await translation.getByText(/【译】/).waitFor()
  assert.equal(await translation.isVisible(), true)
  assert.equal(await page.locator("#shell").evaluate(node => getComputedStyle(node).visibility), "hidden")
  assert.equal(await page.locator("#hidden").evaluate(node => getComputedStyle(node).visibility), "hidden")
  assert.equal(await page.locator("#hidden .readomi-translated-content-wrapper").count(), 0)
  await page.locator("#source").hover()
  await page.keyboard.press("Alt")
  await translation.waitFor({ state: "detached" })
  await page.locator("[data-readomi-layout-owner]").waitFor({ state: "detached" })
  assert.equal(await page.locator("#shell").evaluate(node => getComputedStyle(node).visibility), "hidden")
})
