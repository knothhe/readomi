/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
let release
afterEach(async (test) => {
  release?.()
  await reportFailure(test, context)
  await context?.close()
  await service?.close()
})
async function setup(mode) {
  service = await startFakeService({ streaming: true })
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  await context.serviceWorkers()[0].evaluate(async (mode) => {
    const { config } = await chrome.storage.local.get("config")
    config.features.hoverTranslation = true
    config.features.hoverStream = true
    config.translate.mode = mode
    config.translate.enableAIContentAware = false
    await chrome.storage.local.set({ config })
  }, mode)
  release = service.holdStreamCompletion()
  const page = await context.newPage()
  await page.goto(`${service.origin}/article`)
  return page
}
for (const mode of ["bilingual", "translationOnly"]) {
  it(`inline ${mode} reserves height in line groups and finishes in the same paragraph`, async () => {
    const page = await setup(mode)
    const paragraph = page.locator("p").first()
    const original = await paragraph.innerHTML()
    await paragraph.hover()
    await page.keyboard.press("Alt")
    const preview = page.locator("[data-readomi-inline-preview]")
    await preview.locator(".content").getByText(/阅读和经历/).waitFor()
    const heights = await preview.evaluate(async (node) => {
      const heights = [Number.parseFloat(node.style.height)]
      const observer = new MutationObserver(() => {
        const next = Number.parseFloat(node.style.height)
        if (next !== heights.at(-1))
          heights.push(next)
      })
      observer.observe(node, { attributes: true, attributeFilter: ["style"] })
      await new Promise((resolve) => {
        const frame = () => {
          if (node.shadowRoot.querySelector(".content").textContent.length > 240)
            resolve()
          else
            requestAnimationFrame(frame)
        }
        frame()
      })
      observer.disconnect()
      return heights
    })
    assert.ok(heights.length <= 5, `space grows in a few reservations, not every token: ${heights}`)
    assert.ok(heights.every((height, i) => !i || height > heights[i - 1]), "the flow box never shrinks while streaming")
    assert.equal(await page.locator("[data-readomi-hover-preview]").count(), 0)
    const paragraphTop = (await paragraph.boundingBox()).y
    await page.screenshot({ path: `/tmp/readomi-hover-inline-streaming-${mode}.png`, fullPage: true })
    release()
    await preview.waitFor({ state: "detached" })
    await paragraph.getByText(/阅读和经历/).waitFor()
    assert.equal((await paragraph.boundingBox()).y, paragraphTop, "completion preserves the paragraph's reading position")
    assert.ok(!await paragraph.getAttribute("style"), "replacement restores temporary layout styles")
    await paragraph.hover()
    await page.keyboard.press("Alt")
    await page.waitForFunction(text => document.querySelector("p").innerHTML === text, original)
  })
}
it("cancelling inline replacement restores source and all temporary layout styles", async () => {
  const page = await setup("translationOnly")
  const paragraph = page.locator("p").first()
  await paragraph.evaluate((node) => {
    const child = document.createElement("span")
    child.style.visibility = "visible"
    child.textContent = node.textContent
    node.replaceChildren(child)
  })
  const original = await paragraph.textContent()
  const originalStyle = await paragraph.locator("span").first().getAttribute("style")
  const below = page.locator("p").nth(1)
  const initialY = (await below.boundingBox()).y
  await paragraph.hover()
  await page.keyboard.press("Alt")
  const preview = page.locator("[data-readomi-inline-preview]")
  await preview.locator(".content").getByText(/阅读和经历/).waitFor()
  assert.equal(await paragraph.locator("span").first().evaluate(node => getComputedStyle(node).visibility), "hidden")
  await page.keyboard.press("Escape")
  await preview.waitFor({ state: "detached" })
  await page.waitForFunction(text => document.querySelector("p").textContent === text, original)
  assert.equal(await paragraph.getAttribute("style"), "")
  assert.equal(await paragraph.locator("span").first().getAttribute("style"), originalStyle)
  assert.equal(await paragraph.locator("span").first().evaluate(node => getComputedStyle(node).visibility), "visible")
  assert.equal((await below.boundingBox()).y, initialY)
})
it("inline preview remeasures wrapping in a narrow viewport and restores on disable", async () => {
  const page = await setup("bilingual")
  await page.setViewportSize({ width: 390, height: 640 })
  const paragraph = page.locator("p").first()
  const original = await paragraph.innerHTML()
  await paragraph.hover()
  await page.keyboard.press("Alt")
  const preview = page.locator("[data-readomi-inline-preview]")
  await preview.locator(".content").getByText(/阅读和经历/).waitFor()
  const bounds = await preview.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390)
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.hoverTranslation = false
    await chrome.storage.local.set({ config })
  })
  await preview.waitFor({ state: "detached" })
  await page.waitForFunction(text => document.querySelector("p").innerHTML === text, original)
})

it("waiting for the first output keeps source geometry and can be cancelled", async () => {
  const page = await setup("translationOnly")
  const resume = service.holdAnswers()
  try {
    const paragraph = page.locator("p").first()
    const original = await paragraph.innerHTML()
    const originalText = await paragraph.textContent()
    const initialBounds = await paragraph.boundingBox()
    const below = page.locator("p").nth(1)
    const initialY = (await below.boundingBox()).y
    const count = service.completions().length
    await paragraph.hover()
    await page.keyboard.press("Alt")
    await waitForStreamRequest(count)
    // Observe past the old delayed loading label while the service withholds
    // every output chunk, so a reintroduced waiting UI cannot pass unnoticed.
    await page.waitForTimeout(350)
    assert.equal(await page.getByText("Waiting for translation…", { exact: true }).count(), 0)
    assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
    assert.equal(await paragraph.textContent(), originalText)
    assert.deepEqual(await paragraph.boundingBox(), initialBounds)
    assert.equal((await below.boundingBox()).y, initialY)
    const cancelled = context.waitForEvent("requestfailed", {
      predicate: request => request.url() === `${service.origin}/v1/chat/completions` && request.postDataJSON()?.stream === true,
      timeout: 10_000,
    })
    await page.keyboard.press("Escape")
    assert.match((await cancelled).failure()?.errorText ?? "", /abort|cancel/i)
    await page.waitForFunction(text => document.querySelector("p").innerHTML === text, original)
    assert.deepEqual(await paragraph.boundingBox(), initialBounds)
    assert.equal((await below.boundingBox()).y, initialY)
  }
  finally {
    resume()
  }
})

async function setStreaming(enabled) {
  const options = context.pages()[0]
  await options.goto(options.url().replace(/#.*$/, "#reading"))
  const toggle = options.getByRole("switch", { name: "Stream hover translations", exact: true })
  await toggle.waitFor()
  assert.equal(await toggle.isEnabled(), true)
  if (await toggle.isChecked() !== enabled)
    await toggle.click()
  await options.waitForFunction(async enabled => (await chrome.storage.local.get("config")).config.features.hoverStream === enabled, enabled)
  return { options, toggle }
}
async function waitForStreamRequest(fromIndex) {
  const deadline = Date.now() + 10_000
  while (!service.completions().slice(fromIndex).some(({ body }) => JSON.parse(body).stream === true)) {
    assert.ok(Date.now() < deadline, "hover sends a streaming translation request")
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
async function waitForRequestCount(count) {
  const deadline = Date.now() + 10_000
  while (service.completions().length < count) {
    assert.ok(Date.now() < deadline, "hover sends a translation request")
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
for (const mode of ["bilingual", "translationOnly"]) {
  it(`streaming off persists in settings and waits for the whole ${mode} translation`, async () => {
    const page = await setup(mode)
    const { options } = await setStreaming(false)
    await options.reload()
    assert.equal(await options.getByRole("switch", { name: "Stream hover translations", exact: true }).isChecked(), false)
    if (mode === "bilingual")
      await options.screenshot({ path: "/tmp/readomi-hover-stream-settings.png", fullPage: true })
    const resume = service.holdAnswers()
    try {
      const paragraph = page.locator("p").first()
      const original = await paragraph.textContent()
      const count = service.completions().length
      await page.bringToFront()
      await paragraph.hover()
      await page.keyboard.press("Alt")
      await waitForRequestCount(count + 1)
      assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
      assert.ok((await paragraph.textContent()).includes(original), "the source remains readable until completion")
      assert.ok(service.completions().slice(count).every(({ body }) => !JSON.parse(body).stream), "off uses complete-result requests")
      resume()
      await paragraph.getByText(/【译】/).waitFor()
      assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
      await paragraph.hover()
      await page.keyboard.press("Alt")
      await page.waitForFunction(text => document.querySelector("p").textContent === text, original)
    }
    finally {
      resume()
    }
  })
}
it("turning streaming off mid-translation cancels the preview and the next hover waits for completion", async () => {
  const page = await setup("translationOnly")
  const paragraph = page.locator("p").first()
  const original = await paragraph.innerHTML()
  await paragraph.hover()
  await page.keyboard.press("Alt")
  const preview = page.locator("[data-readomi-inline-preview]")
  await preview.locator(".content").getByText(/阅读和经历/).waitFor()
  await setStreaming(false)
  await preview.waitFor({ state: "detached" })
  await page.waitForFunction(text => document.querySelector("p").innerHTML === text, original)
  const count = service.completions().length
  await page.bringToFront()
  await paragraph.hover()
  await page.keyboard.press("Alt")
  await paragraph.getByText(/【译】/).waitFor()
  assert.ok(service.completions().slice(count).every(({ body }) => !JSON.parse(body).stream))
  assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
})
it("a grid paragraph uses complete-result rendering to preserve its layout", async () => {
  const page = await setup("bilingual")
  const paragraph = page.locator("p").first()
  await paragraph.evaluate(node => node.style.display = "grid")
  const count = service.completions().length
  await paragraph.hover()
  await page.keyboard.press("Alt")
  await paragraph.getByText(/【译】/).waitFor()
  assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
  assert.ok(service.completions().slice(count).every(({ body }) => !JSON.parse(body).stream))
  assert.equal(await paragraph.evaluate(node => getComputedStyle(node).display), "grid")
})
it("a source update while waiting cancels the old translation without overwriting the new text", async () => {
  const page = await setup("translationOnly")
  const resume = service.holdAnswers()
  try {
    const paragraph = page.locator("p").first()
    const count = service.completions().length
    await paragraph.hover()
    await page.keyboard.press("Alt")
    await waitForStreamRequest(count)
    assert.equal(await page.getByText("Waiting for translation…", { exact: true }).count(), 0)
    const cancelled = context.waitForEvent("requestfailed", {
      predicate: request => request.url() === `${service.origin}/v1/chat/completions` && request.postDataJSON()?.stream === true,
      timeout: 10_000,
    })
    await paragraph.evaluate(node => node.textContent = "The article was updated while the translation was waiting.")
    assert.match((await cancelled).failure()?.errorText ?? "", /abort|cancel/i)
    resume()
    assert.equal(await paragraph.textContent(), "The article was updated while the translation was waiting.")
    assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
  }
  finally {
    resume()
  }
})
