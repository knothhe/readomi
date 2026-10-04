/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, it } from "node:test"
import { extensionPath, launchBrowser, reportFailure } from "./browser.mjs"

let context

afterEach(async (test) => {
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    context = undefined
  }
})

function dimensions(popup) {
  return popup.evaluate(() => {
    const root = document.querySelector("#root").getBoundingClientRect()
    const footer = document.querySelector("footer").getBoundingClientRect()
    const scroller = document.scrollingElement
    return {
      contentHeight: root.height,
      viewportHeight: innerHeight,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      footerBottom: footer.bottom,
    }
  })
}

it("fits every UI language without scrolling, and keeps the footer reachable in shorter viewports", async (test) => {
  const launched = await launchBrowser()
  context = launched.context
  const worker = context.serviceWorkers()[0]
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 320, height: 600 })
  await popup.goto(`chrome-extension://${launched.extensionId}/popup.html`)
  await popup.locator("#root section").first().waitFor()
  // Seed a configured service without sending a request. Opening popup.html
  // as a tab makes the active page unavailable, reproducing both notices in
  // the reported layout. Toolbar sizing/user gestures are not covered here.
  await worker.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.providersConfig.find(provider => provider.id === config.translate.providerId).apiKey = "test-only-key"
    config.features.hoverTranslation = true
    config.features.videoSubtitles = true
    config.features.hoverHotkey = "backtick"
    config.appearance.mode = "dark"
    await chrome.storage.local.set({ config })
  })

  const localePath = resolve(extensionPath, "_locales")
  const locales = (await readdir(localePath)).sort()
  for (const locale of locales) {
    // Use a real storage change to exercise the live language provider, then
    // check the reopened popup as well. Labels come from the built catalog.
    const messages = JSON.parse(await readFile(resolve(localePath, locale, "messages.json"), "utf8"))
    await worker.evaluate(async (language) => {
      const { config } = await chrome.storage.local.get("config")
      config.ui.language = language
      await chrome.storage.local.set({ config })
    }, locale.replaceAll("_", "-"))
    for (const reopened of [false, true]) {
      if (reopened)
        await popup.reload()
      await popup.getByRole("region", { name: messages.options_language_title.message, exact: true }).waitFor()
      await popup.evaluate(() => document.fonts.ready)
      const size = await dimensions(popup)
      const label = `${locale}, ${reopened ? "reopened" : "live switch"}: ${JSON.stringify(size)}`
      assert.ok(size.contentHeight <= size.viewportHeight, label)
      assert.equal(size.scrollHeight, size.clientHeight, label)
      assert.equal(size.scrollWidth, size.clientWidth, label)
      assert.ok(size.footerBottom <= size.viewportHeight, label)
    }
    test.diagnostic(`${locale}: entire popup fits within 320 × 600`)
  }

  await popup.setViewportSize({ width: 320, height: 480 })
  const shorter = await dimensions(popup)
  assert.ok(shorter.scrollHeight > shorter.clientHeight, JSON.stringify(shorter))
  await popup.locator("footer").scrollIntoViewIfNeeded()
  const scrolled = await dimensions(popup)
  assert.ok(scrolled.footerBottom <= scrolled.viewportHeight, JSON.stringify(scrolled))
  assert.ok(await popup.evaluate(() => document.scrollingElement.scrollTop > 0))
})
