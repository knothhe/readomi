/* global chrome -- worker.evaluate() runs in the extension service worker. */
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, pressTranslateShortcut, reportFailure, storedConfig } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
let profile

afterEach(async (test) => {
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
    if (profile)
      await rm(profile, { recursive: true, force: true })
    context = service = profile = undefined
  }
})

async function expectIcon(worker, color, tabId, translated) {
  await worker.evaluate(async ({ color, tabId, translated }) => {
    const expected = `/icon/${color}/${translated ? "translated-" : ""}16.png`
    for (let i = 0; i < 100; i++) {
      if (globalThis.readomiIconCalls.some(call => call.tabId === tabId && call.path?.[16] === expected))
        return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`toolbar icon was not updated to ${expected} for tab ${tabId}`)
  }, { color, tabId, translated })
}

it("switches all four themes across settings, popup, translated pages and toolbar icons, then restores the choice after restart", async () => {
  profile = await mkdtemp(join(tmpdir(), "readomi-theme-"))
  service = await startFakeService()
  const launched = await launchBrowser({ userDataDir: profile })
  context = launched.context
  const { page, extensionId } = launched
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  const article = await context.newPage()
  await article.goto(`${service.origin}/article`)
  const worker = context.serviceWorkers()[0]
  await worker.evaluate(() => {
    globalThis.readomiIconCalls = []
    const original = chrome.action.setIcon.bind(chrome.action)
    chrome.action.setIcon = async (details) => {
      await original(details)
      globalThis.readomiIconCalls.push(details)
    }
  })
  await pressTranslateShortcut(article)
  await article.locator(".readomi-translated-block-content").first().waitFor({ timeout: 15_000 })
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, article.url())
  await expectIcon(worker, "terra", tabId, true)
  await article.waitForFunction(() => document.querySelectorAll(".readomi-translated-block-content").length === 5)
  const originalColor = await article.locator("h1").evaluate(el => getComputedStyle(el).color)
  const requests = service.completions().length
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.goto(`chrome-extension://${extensionId}/options.html#appearance`)
  const themes = [
    ["plum", "Plum", "#79546D"], ["amber", "Amber", "#946214"],
    ["teal", "Teal", "#246F73"], ["terra", "Terra", "#B6533E"],
  ]
  for (const [color, label, primary] of themes) {
    await worker.evaluate(() => {
      globalThis.readomiIconCalls = []
    })
    await page.getByRole("radio", { name: label, exact: true }).click()
    await page.waitForFunction(color => document.documentElement.dataset.readomiTheme === color, color)
    await popup.waitForFunction(color => document.documentElement.dataset.readomiTheme === color, color)
    await article.waitForFunction(primary => getComputedStyle(document.documentElement).getPropertyValue("--readomi-brand").trim().toUpperCase() === primary, primary)
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--rf-primary").trim()), primary)
    // Applying the theme updates the image URL before the new image has loaded.
    await page.waitForFunction((color) => {
      const icon = document.querySelector("aside img")
      return icon?.src.endsWith(`/icon/${color}/32.png`) && icon.complete && icon.naturalWidth > 0
    }, color, { timeout: 5_000 })
    const icons = await page.locator("aside img").evaluateAll(images => images.map(img => ({ src: img.src, loaded: img.complete && img.naturalWidth > 0 })))
    assert.equal(icons[0].loaded, true)
    assert.match(icons[0].src, new RegExp(`/icon/${color}/32.png$`))
    await expectIcon(worker, color, undefined, false)
    await expectIcon(worker, color, tabId, true)
    await article.waitForFunction((primary) => {
      const probe = document.createElement("span")
      probe.style.color = primary
      document.body.append(probe)
      const expected = getComputedStyle(probe).color
      probe.remove()
      return [...document.querySelectorAll(".readomi-translated-block-content")].every(el => getComputedStyle(el).color === expected)
    }, primary)
    assert.equal(await article.locator("h1").evaluate(el => getComputedStyle(el).color), originalColor, "only translations receive the theme color")
    assert.equal((await storedConfig(context)).appearance.colorTheme, color)
  }
  assert.equal(service.completions().length, requests, "changing color does not request translations again")
  if (process.env.WEB_THEME_SCREENSHOT)
    await article.screenshot({ path: process.env.WEB_THEME_SCREENSHOT })
  await popup.getByRole("group", { name: "Web text display mode" }).getByRole("button", { name: "Translation only", exact: true }).click()
  await article.waitForFunction(() => {
    const translations = [...document.querySelectorAll(".readomi-translated-content-wrapper[data-readomi-translation-mode=\"translationOnly\"]")]
    return translations.length === 5 && translations.every(el => getComputedStyle(el).color === "rgb(182, 83, 62)")
  })
  assert.equal(service.completions().length, requests, "switching modes keeps the translated text and its theme color")
  await page.getByRole("radio", { name: "Plum", exact: true }).click()
  await article.emulateMedia({ colorScheme: "dark" })
  await article.waitForFunction(() => [...document.querySelectorAll(".readomi-translated-content-wrapper[data-readomi-translation-mode=\"translationOnly\"]")].every(el => getComputedStyle(el).color === "rgb(199, 165, 190)"))
  await page.emulateMedia({ colorScheme: "dark" })
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--rf-primary").trim() === "#C7A5BE")
  assert.equal(await page.locator("#appearance").evaluate(el => el.scrollWidth <= el.clientWidth), true)
  await context.close()
  context = undefined
  const restarted = await launchBrowser({ userDataDir: profile })
  context = restarted.context
  await restarted.page.goto(`chrome-extension://${extensionId}/options.html#appearance`)
  await restarted.page.getByRole("radio", { name: "Plum", exact: true }).waitFor()
  assert.equal(await restarted.page.getByRole("radio", { name: "Plum", exact: true }).getAttribute("aria-checked"), "true")
  assert.equal((await storedConfig(context)).appearance.colorTheme, "plum")
})
