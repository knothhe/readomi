import assert from "node:assert/strict"
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

// A generic chat page routes printable keys into its composer, even when the
// reader has focus in the message history. Document capture runs before target
// listeners, so this also checks that Readomi claims the key earlier than the
// host's keyboard router. This fixture has no hostname-specific behavior.
function chatFixture(kind) {
  const composer = kind === "contenteditable"
    ? "<div id=\"composer\" contenteditable=\"true\" role=\"textbox\" aria-label=\"Message\"></div>"
    : "<textarea id=\"composer\" aria-label=\"Message\"></textarea>"
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title></title>
<style>body{max-width:640px;margin:40px auto;font:16px/1.6 Arial,sans-serif}#message{margin:24px 0;padding:12px;background:#eee}#composer{display:block;box-sizing:border-box;width:100%;min-height:80px;border:1px solid #999;padding:12px}</style>
</head><body><h1>Chat history</h1>
<p id="message">Reading and experience keep changing the way we understand the world.</p>
<label for="composer">Message</label>${composer}
<script>
const composer = document.querySelector("#composer")
window.__siteKeys = []
document.addEventListener("keydown", event => {
  window.__siteKeys.push({ type: event.type, key: event.key })
  if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey
      || event.target.closest?.("input,textarea,[contenteditable='true']"))
    return
  composer.focus()
  if (composer.isContentEditable)
    composer.textContent += event.key
  else
    composer.value += event.key
  event.preventDefault()
}, true)
document.addEventListener("keyup", event => {
  window.__siteKeys.push({ type: event.type, key: event.key })
}, true)
</script></body></html>`
}

async function selectTrigger(options, name, value) {
  await options.locator("nav a[href=\"#shortcut\"]").click()
  await options.getByRole("combobox", { name: "Hover translation trigger", exact: true }).click()
  await options.getByRole("option", { name, exact: true }).click()
  await options.waitForFunction(async value => (await globalThis.chrome.storage.local.get("config")).config.features.hoverHotkey === value, value)
}

async function setup(kind) {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const options = launched.page
  await configureService(options, launched.extensionId, setupDocumentFor(service.origin))
  await options.locator("nav a[href=\"#reading\"]").click()
  await options.getByRole("switch", { name: "Hover translation", exact: true }).click()
  const streaming = options.getByRole("switch", { name: "Stream hover translations", exact: true })
  if (await streaming.isChecked())
    await streaming.click()
  await selectTrigger(options, "Backtick (`)", "backtick")
  const config = await storedConfig(context)
  assert.equal(config.features.hoverTranslation, true)
  assert.equal(config.features.hoverStream, false)

  const url = `${service.origin}/hover-key-routing`
  await context.route(url, route => route.fulfill({ contentType: "text/html", body: chatFixture(kind) }))
  const page = await context.newPage()
  await page.goto(url)
  await page.bringToFront()
  return { options, page }
}

async function composerState(page) {
  return page.locator("#composer").evaluate(node => ({
    text: node.isContentEditable ? node.textContent : node.value,
    focused: node.ownerDocument.activeElement === node,
  }))
}

async function resetHost(page) {
  await page.evaluate(() => {
    const composer = document.querySelector("#composer")
    if (composer.isContentEditable)
      composer.textContent = ""
    else
      composer.value = ""
    composer.blur()
    window.__siteKeys = []
  })
  await page.locator("#message").hover()
}

async function waitForBacktickPassThrough(page) {
  // The options page's storage read can finish before this content script's
  // configuration watcher receives the change. Probe after Readomi's window
  // capture listener, absorbing these synthetic events before the host router.
  // The assertions below still exercise a native press and its complete route.
  await page.waitForFunction(() => {
    const received = new Set()
    const observe = (event) => {
      received.add(event.type)
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", observe, true)
    window.addEventListener("keyup", observe, true)
    try {
      for (const type of ["keydown", "keyup"]) {
        document.body.dispatchEvent(new KeyboardEvent(type, {
          key: "`", code: "Backquote", bubbles: true, cancelable: true,
        }))
      }
      return received.size === 2
    }
    finally {
      window.removeEventListener("keydown", observe, true)
      window.removeEventListener("keyup", observe, true)
    }
  }, undefined, { timeout: 5000 })
}

async function assertClaimed(page) {
  assert.deepEqual(await composerState(page), { text: "", focused: false }, "the trigger never reaches or focuses the composer")
  assert.deepEqual(await page.evaluate(() => window.__siteKeys), [], "the host receives neither keydown nor keyup of the claimed press")
}

async function assertPassedThrough(page, key, text) {
  assert.deepEqual(await composerState(page), { text, focused: true })
  assert.deepEqual(await page.evaluate(() => window.__siteKeys), [
    { type: "keydown", key },
    { type: "keyup", key },
  ])
}

for (const kind of ["textarea", "contenteditable"]) {
  it(`claims backtick before the chat keyboard router and preserves ${kind} editing`, async () => {
    const { options, page } = await setup(kind)
    const message = page.locator("#message")
    const translation = message.locator(".readomi-translated-block-content")
    const original = await message.innerHTML()
    await message.hover()

    // A tap translates and a second tap restores, without letting the host
    // focus its composer between keydown and keyup.
    await page.keyboard.press("Backquote")
    await translation.getByText(/【译】/).waitFor({ timeout: 15_000 })
    await assertClaimed(page)
    await page.screenshot({ path: `/tmp/readomi-hover-key-${kind}-ready.png`, fullPage: true })
    await message.hover()
    await page.keyboard.press("Backquote")
    await translation.waitFor({ state: "detached" })
    assert.equal(await message.innerHTML(), original)
    await assertClaimed(page)

    // Repeated keydown while holding must also be claimed. Releasing a hold
    // that already translated must not toggle the paragraph a second time.
    await message.hover()
    await page.keyboard.down("Backquote")
    await page.keyboard.down("Backquote")
    await translation.getByText(/【译】/).waitFor({ timeout: 15_000 })
    await page.keyboard.down("Backquote")
    await page.keyboard.up("Backquote")
    await page.waitForTimeout(650)
    assert.equal(await translation.count(), 1)
    await assertClaimed(page)
    await message.hover()
    await page.keyboard.press("Backquote")
    await translation.waitFor({ state: "detached" })

    // Mouse position over readable text does not override an already focused
    // editor. Native character input and both host events remain available.
    await resetHost(page)
    await page.locator("#composer").focus()
    await message.hover()
    const requests = service.completions().length
    await page.keyboard.press("Backquote")
    await assertPassedThrough(page, "`", "`")
    await page.waitForTimeout(650)
    assert.equal(await translation.count(), 0)
    assert.equal(service.completions().length, requests)

    await resetHost(page)
    await page.keyboard.press("a")
    await assertPassedThrough(page, "a", "a")

    if (kind === "textarea") {
      // Existing tabs release the key when the feature is disabled or when
      // the user selects another trigger through the actual settings UI.
      await options.locator("nav a[href=\"#reading\"]").click()
      await options.getByRole("switch", { name: "Hover translation", exact: true }).click()
      await options.waitForFunction(async () => !(await globalThis.chrome.storage.local.get("config")).config.features.hoverTranslation)
      await page.bringToFront()
      await resetHost(page)
      await waitForBacktickPassThrough(page)
      await page.keyboard.press("Backquote")
      await assertPassedThrough(page, "`", "`")

      await options.getByRole("switch", { name: "Hover translation", exact: true }).click()
      await selectTrigger(options, /^(Option \/ )?Alt$/, "alt")
      await page.bringToFront()
      await resetHost(page)
      await waitForBacktickPassThrough(page)
      await page.keyboard.press("Backquote")
      await assertPassedThrough(page, "`", "`")
      await page.waitForTimeout(650)
      assert.equal(await translation.count(), 0)
    }
  })
}
