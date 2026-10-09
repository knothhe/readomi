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
    const resume = service.holdAnswers()
    try {
      const count = service.completions().length
      await paragraph.hover()
      await page.keyboard.press("Alt")
      await waitForStreamRequest(count)
      await paragraph.locator(".readomi-spinner").waitFor({ state: "visible" })
      assert.equal(await paragraph.locator(".readomi-spinner:visible").count(), 1)
      assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
    }
    finally {
      resume()
    }
    const preview = page.locator("[data-readomi-inline-preview]")
    await preview.locator(".content").getByText(/阅读和经历/).waitFor()
    assert.equal(await paragraph.locator(".readomi-spinner:visible").count(), 0, "the loading dot disappears when the stream first becomes readable")
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
    assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
    assert.equal((await paragraph.boundingBox()).y, paragraphTop, "completion preserves the paragraph's reading position")
    assert.ok(!await paragraph.getAttribute("style"), "replacement restores temporary layout styles")
    await paragraph.hover()
    await page.keyboard.press("Alt")
    await page.waitForFunction(text => document.querySelector("p").innerHTML === text, original)
  })
}
async function typography(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
    }
  })
}
const commentTypography = { fontSize: "14px", lineHeight: "20px", fontWeight: "500", letterSpacing: "0.3px" }
// Match X's text boundary: a block tweetText container with one inline span.
// Fulfill the host locally so this regression does not require a login or a
// live tweet, while the content script still receives X's hostname rules.
const xTweetFixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>X tweet translation</title></head>
<body style="max-width:600px;margin:40px auto;font:17px/24px Arial,sans-serif"><article>
<div data-testid="tweetText" style="display:block;white-space:pre-wrap"><span id="tweet-source" style="display:inline">how bro was holding that fx3</span></div>
</article><p>Another tweet stays below this one.</p></body></html>`

async function quoteAppearance(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      borderLeftWidth: style.borderLeftWidth,
      borderLeftStyle: style.borderLeftStyle,
      paddingLeft: style.paddingLeft,
    }
  })
}

for (const preset of ["blockquote", "line"]) {
  for (const streaming of [true, false]) {
    it(`X ${preset} remains separate after ${streaming ? "streaming" : "complete-result"} translation`, async () => {
      const page = await setup("bilingual")
      await context.serviceWorkers()[0].evaluate(async ({ preset, streaming }) => {
        const { config } = await chrome.storage.local.get("config")
        config.features.hoverStream = streaming
        config.translate.translationNodeStyle = { preset, isCustom: false, customCSS: "" }
        await chrome.storage.local.set({ config })
      }, { preset, streaming })
      const fixtureURL = "https://x.com/readomi-test/status/1"
      await page.route(fixtureURL, route => route.fulfill({ contentType: "text/html", body: xTweetFixture }))
      await page.goto(fixtureURL)
      const tweet = page.locator("[data-testid='tweetText']")
      const source = await tweet.locator("#tweet-source").elementHandle()
      const sourceText = await source.textContent()
      const paragraphTop = (await tweet.boundingBox()).y
      await tweet.hover()
      await page.keyboard.press("Alt")

      const preview = page.locator("[data-readomi-inline-preview]")
      let streamingAppearance
      if (streaming) {
        const previewText = preview.locator(".preview-translation")
        await previewText.getByText(/阅读和经历/).waitFor()
        streamingAppearance = await quoteAppearance(previewText)
        assert.equal(await previewText.getAttribute("data-readomi-custom-translation-style"), preset)
        assert.equal(streamingAppearance.borderLeftWidth, preset === "blockquote" ? "4px" : "2px")
        release()
        await preview.waitFor({ state: "detached" })
      }

      const translation = tweet.locator(".readomi-translated-block-content")
      await translation.getByText(streaming ? /阅读和经历/ : /【译】/).waitFor()
      assert.equal(await tweet.locator(".readomi-translated-inline-content").count(), 0)
      assert.equal(await tweet.locator(".readomi-translated-content-wrapper").count(), 1)
      assert.equal(await translation.getAttribute("data-readomi-custom-translation-style"), preset)
      assert.equal(await translation.evaluate(node => node.parentElement.parentElement.dataset.testid), "tweetText")
      const completedAppearance = await quoteAppearance(translation)
      assert.equal(completedAppearance.borderLeftWidth, preset === "blockquote" ? "4px" : "2px")
      assert.equal(completedAppearance.borderLeftStyle, "solid")
      assert.equal(completedAppearance.fontSize, "17px")
      if (streaming)
        assert.deepEqual(completedAppearance, streamingAppearance, "the selected quote style and typography survive completion")
      else
        assert.equal(await preview.count(), 0)
      const sourceBounds = await source.boundingBox()
      const translatedBounds = await translation.boundingBox()
      assert.ok(translatedBounds.y >= sourceBounds.y + sourceBounds.height, "the translation begins below the source tweet")
      assert.equal((await tweet.boundingBox()).y, paragraphTop)
      await tweet.hover()
      await page.keyboard.press("Alt")
      await translation.waitFor({ state: "detached" })
      assert.equal(await tweet.textContent(), sourceText)
      assert.equal(await source.evaluate(node => node === document.querySelector("#tweet-source")), true, "toggle preserves the original span")
    })
  }
}

for (const { mode, customCSS, expected } of [
  { mode: "bilingual", expected: commentTypography },
  { mode: "translationOnly", expected: commentTypography },
  {
    mode: "bilingual",
    customCSS: "[data-readomi-custom-translation-style='custom'] { font-size:1.2em;line-height:1.5;font-weight:600;letter-spacing:0.05em }",
    expected: { fontSize: "16.8px", lineHeight: "25.2px", fontWeight: "600", letterSpacing: "0.84px" },
  },
]) {
  it(`nested ${mode} inherits comment typography throughout streaming${customCSS ? " with relative custom CSS" : ""}`, async () => {
    const page = await setup(mode)
    if (customCSS) {
      await context.serviceWorkers()[0].evaluate(async (customCSS) => {
        const { config } = await chrome.storage.local.get("config")
        config.translate.translationNodeStyle = { preset: "line", isCustom: true, customCSS }
        await chrome.storage.local.set({ config })
      }, customCSS)
    }
    const paragraph = page.locator("p").first()
    // YouTube comment text has its own typography inside a smaller flow-root
    // container. The preview reserves space in that container, while the final
    // translation is inserted inside the single inline child.
    await paragraph.evaluate((node) => {
      const comment = document.createElement("span")
      comment.style.cssText = "display:inline;font-size:14px;line-height:20px;font-weight:500;letter-spacing:0.3px"
      comment.textContent = node.textContent
      node.style.cssText = "display:flow-root;font-size:10px;line-height:normal;font-weight:400;letter-spacing:normal"
      node.replaceChildren(comment)
    })
    assert.deepEqual(await typography(paragraph.locator("span").first()), commentTypography)
    await paragraph.hover()
    await page.keyboard.press("Alt")
    const preview = page.locator("[data-readomi-inline-preview]")
    const streamingText = preview.locator(".group").first()
    await streamingText.getByText(/阅读和经历/).waitFor()
    const streamingTypography = await typography(streamingText)
    release()
    await preview.waitFor({ state: "detached" })
    const wrapper = paragraph.locator(`[data-readomi-translation-mode="${mode}"]`)
    await wrapper.getByText(/阅读和经历/).waitFor()
    const translatedText = mode === "bilingual"
      ? wrapper.locator(".readomi-translated-block-content, .readomi-translated-inline-content")
      : wrapper
    const completedTypography = await typography(translatedText)
    assert.deepEqual(completedTypography, expected, "completion inherits the inner comment text's typography")
    assert.deepEqual(streamingTypography, expected, "streaming inherits the inner comment text's typography")
    assert.deepEqual(streamingTypography, completedTypography, "completion does not change the translation's typography")
  })
}
it("separate streaming groups retain each nested comment's typography", async () => {
  const page = await setup("bilingual")
  const source = page.locator("p").first()
  const expected = [
    commentTypography,
    { fontSize: "20px", lineHeight: "28px", fontWeight: "700", letterSpacing: "0.6px" },
  ]
  await source.evaluate((source, styles) => {
    const text = source.textContent
    const node = document.createElement("div")
    node.id = "nested-comments"
    source.replaceWith(node)
    node.style.cssText = "display:flow-root;font-size:10px;line-height:normal;font-weight:400;letter-spacing:normal;padding:12px"
    node.replaceChildren(...styles.map((style, index) => {
      const block = document.createElement("p")
      block.dataset.commentGroup = index
      const comment = document.createElement("span")
      Object.assign(comment.style, style)
      comment.textContent = text
      block.append(comment)
      return block
    }))
  }, expected)
  const paragraph = page.locator("#nested-comments")
  // Semantic paragraphs reserve block previews for each comment.
  // The outer container owns the padding, so this pointer position translates
  // both nested blocks in one hover rather than only the inner text under it.
  await paragraph.hover({ position: { x: 5, y: 5 } })
  await page.keyboard.press("Alt")
  const preview = page.locator("[data-readomi-inline-preview]")
  const groups = preview.locator(".group")
  await groups.nth(1).getByText(/阅读和经历/).waitFor()
  assert.equal(await groups.count(), 2)
  const streamingTypography = await Promise.all(expected.map((_, index) => typography(groups.nth(index))))
  release()
  await preview.waitFor({ state: "detached" })
  const completedTypography = []
  for (let index = 0; index < expected.length; index++) {
    const translation = paragraph.locator(`[data-comment-group="${index}"] .readomi-translated-block-content, [data-comment-group="${index}"] .readomi-translated-inline-content`)
    await translation.getByText(/阅读和经历/).waitFor()
    completedTypography.push(await typography(translation))
  }
  assert.deepEqual(completedTypography, expected, "completed groups inherit their respective inner text")
  assert.deepEqual(streamingTypography, expected, "streaming groups inherit their respective inner text")
  assert.deepEqual(streamingTypography, completedTypography, "neither group changes typography on completion")
})
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
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
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
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
})

for (const mode of ["bilingual", "translationOnly"]) {
  it(`waiting for the first ${mode} output shows a loading dot and can be cancelled`, async () => {
    const page = await setup(mode)
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
      await paragraph.locator(".readomi-spinner").waitFor({ state: "visible" })
      // The service withholds every output chunk; the existing page loading dot
      // remains visible without replacing the source or reserving preview space.
      await page.waitForTimeout(350)
      assert.equal(await paragraph.locator(".readomi-spinner:visible").count(), 1)
      assert.equal(await page.getByText("Waiting for translation…", { exact: true }).count(), 0)
      assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
      assert.equal(await paragraph.textContent(), originalText)
      assert.deepEqual(await paragraph.boundingBox(), initialBounds)
      assert.equal((await below.boundingBox()).y, initialY)
      if (mode === "bilingual")
        await page.screenshot({ path: "/tmp/readomi-hover-waiting.png", fullPage: true })
      const cancelled = context.waitForEvent("requestfailed", {
        predicate: request => request.url() === `${service.origin}/v1/chat/completions` && request.postDataJSON()?.stream === true,
        timeout: 10_000,
      })
      await page.keyboard.press("Escape")
      assert.match((await cancelled).failure()?.errorText ?? "", /abort|cancel/i)
      await page.waitForFunction(text => document.querySelector("p").innerHTML === text, original)
      assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
      assert.deepEqual(await paragraph.boundingBox(), initialBounds)
      assert.equal((await below.boundingBox()).y, initialY)
    }
    finally {
      resume()
    }
  })
}

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
    await options.getByRole("switch", { name: "Stream hover translations", exact: true, checked: false }).waitFor()
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
      await paragraph.locator(".readomi-spinner").waitFor({ state: "visible" })
      assert.equal(await paragraph.locator(".readomi-spinner:visible").count(), 1)
      assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
      assert.ok((await paragraph.textContent()).includes(original), "the source remains readable until completion")
      assert.ok(service.completions().slice(count).every(({ body }) => !JSON.parse(body).stream), "off uses complete-result requests")
      resume()
      await paragraph.getByText(/【译】/).waitFor()
      assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
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
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
  const count = service.completions().length
  await page.bringToFront()
  await paragraph.hover()
  await page.keyboard.press("Alt")
  await paragraph.getByText(/【译】/).waitFor()
  assert.ok(service.completions().slice(count).every(({ body }) => !JSON.parse(body).stream))
  assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
})
it("turning streaming off while waiting cancels the loading dot and the next hover waits for completion", async () => {
  const page = await setup("translationOnly")
  const paragraph = page.locator("p").first()
  const original = await paragraph.innerHTML()
  const resume = service.holdAnswers()
  try {
    const count = service.completions().length
    await paragraph.hover()
    await page.keyboard.press("Alt")
    await waitForStreamRequest(count)
    await paragraph.locator(".readomi-spinner").waitFor({ state: "visible" })
    await setStreaming(false)
    await page.waitForFunction(text => document.querySelector("p").innerHTML === text, original)
    assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
    assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
  }
  finally {
    resume()
  }
  const count = service.completions().length
  await page.bringToFront()
  await paragraph.hover()
  await page.keyboard.press("Alt")
  await paragraph.getByText(/【译】/).waitFor()
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
  assert.ok(service.completions().slice(count).every(({ body }) => !JSON.parse(body).stream))
  assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
})
it("a grid paragraph uses complete-result rendering to preserve its layout", async () => {
  const page = await setup("bilingual")
  const paragraph = page.locator("p").first()
  await paragraph.evaluate(node => node.style.display = "grid")
  const count = service.completions().length
  const resume = service.holdAnswers()
  try {
    await paragraph.hover()
    await page.keyboard.press("Alt")
    await waitForRequestCount(count + 1)
    await paragraph.locator(".readomi-spinner").waitFor({ state: "visible" })
    assert.equal(await paragraph.locator(".readomi-spinner:visible").count(), 1)
    assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
  }
  finally {
    resume()
  }
  await paragraph.getByText(/【译】/).waitFor()
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
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
    await paragraph.locator(".readomi-spinner").waitFor({ state: "visible" })
    assert.equal(await page.getByText("Waiting for translation…", { exact: true }).count(), 0)
    const cancelled = context.waitForEvent("requestfailed", {
      predicate: request => request.url() === `${service.origin}/v1/chat/completions` && request.postDataJSON()?.stream === true,
      timeout: 10_000,
    })
    await paragraph.evaluate(node => node.textContent = "The article was updated while the translation was waiting.")
    assert.match((await cancelled).failure()?.errorText ?? "", /abort|cancel/i)
    resume()
    assert.equal(await paragraph.textContent(), "The article was updated while the translation was waiting.")
    assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
    assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
  }
  finally {
    resume()
  }
})
