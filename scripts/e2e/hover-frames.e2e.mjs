/* global chrome */
import assert from "node:assert/strict"
import { it } from "node:test"
import { configureService, launchBrowser } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

it("routes gestures between the timeline and the visible detail pane", async (t) => {
  const service = await startFakeService()
  const { context, page, extensionId } = await launchBrowser()
  t.after(async () => {
    await context.close()
    await service.close()
  })
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    Object.assign(config.features, { hoverTranslation: true, hoverStream: false, hoverHotkey: "backtick" })
    await chrome.storage.local.set({ config })
  })
  await context.route(`${service.origin}/fixture/*`, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()
    const frames = name === "timeline" ? "<iframe src=\"first\"></iframe><iframe hidden src=\"second\"></iframe>" : ""
    return route.fulfill({ contentType: "text/html", body: `<html lang="en"><body><p tabindex="-1">This paragraph describes the ${name} for readers learning another language.</p>${frames}<section>Another paragraph on the ${name} should appear when page translation starts.</section></body></html>` })
  })
  await context.route("**/pending-image", () => {})
  await page.goto(`${service.origin}/fixture/timeline`)
  const initialRequests = service.translationRequests().length
  const first = page.frameLocator("iframe").first()
  const second = page.frameLocator("iframe").last()
  const wrapper = ".readomi-translated-content-wrapper"
  // Allow the manifest scripts to initialize. The first key follows frame entry immediately.
  await page.waitForTimeout(300)
  await page.locator("p").focus()
  await first.locator("p").hover()
  assert.equal(service.translationRequests().length, initialRequests)
  await page.keyboard.press("Backquote")
  await first.locator(wrapper).waitFor({ timeout: 5000 })
  assert.equal(await page.locator(wrapper).count(), 0)
  await page.locator("iframe").evaluateAll(([a, b]) => {
    a.hidden = true
    b.hidden = false
  })
  await page.waitForTimeout(200)
  await page.keyboard.press("Backquote")
  await second.locator(wrapper).waitFor({ timeout: 5000 })
  assert.equal(await first.locator(wrapper).count(), 1)
  const reloaded = page.waitForEvent("framenavigated", frame => frame.url().endsWith("/second"))
  await second.locator("body").evaluate(() => location.reload())
  await reloaded
  await second.locator("p").waitFor()
  await page.waitForTimeout(200)
  await page.keyboard.press("Backquote")
  await second.locator(wrapper).waitFor({ timeout: 5000 })
  await second.locator("p").focus()
  await page.locator("p").hover()
  await page.keyboard.press("Backquote")
  await page.locator(wrapper).waitFor({ timeout: 5000 })
  await page.keyboard.press("Alt+e")
  await page.locator("section").locator(wrapper).waitFor({ timeout: 5000 })
  await second.locator("section").locator(wrapper).waitFor({ timeout: 5000 })
  await page.keyboard.press("Alt+e")
  await second.locator(wrapper).first().waitFor({ state: "detached", timeout: 5000 })
  await page.locator(wrapper).first().waitFor({ state: "detached", timeout: 5000 })

  await page.locator("iframe").first().evaluate((frame) => {
    frame.hidden = false
  })
  for (const [hotkey, key] of [["alt", "Alt"], ["control", "Control"], ["shift", "Shift"], ["backtick", "Backquote"], ["clickAndHold", null]]) {
    await context.serviceWorkers()[0].evaluate(async (hotkey) => {
      const { config } = await chrome.storage.local.get("config")
      config.features.hoverHotkey = hotkey
      await chrome.storage.local.set({ config })
    }, hotkey)
    await second.locator("p").focus()
    await first.locator("p").hover()
    if (key) {
      await page.keyboard.down(key)
      await first.locator(wrapper).waitFor({ timeout: 5000 })
      await page.keyboard.up(key)
      await page.keyboard.press(key)
      await first.locator(wrapper).waitFor({ state: "detached", timeout: 5000 })
    }
    else {
      await page.mouse.down()
      await first.locator(wrapper).waitFor({ timeout: 5000 })
      await page.mouse.up()
    }
    assert.equal(await second.locator(wrapper).count(), 0)
    assert.equal(await page.locator(wrapper).count(), 0)
  }

  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.hoverHotkey = "backtick"
    await chrome.storage.local.set({ config })
  })
  await page.evaluate(() => {
    const host = document.createElement("div")
    document.body.replaceChildren(host)
    const root = host.attachShadow({ mode: "open" })
    root.innerHTML = `<p tabindex="0">This paragraph in the shadow tree describes another language.</p>
      <iframe src="first" style="width:800px;height:280px;padding:30px;transform:scale(.5);transform-origin:top left"></iframe>`
    const hanging = document.createElement("iframe")
    hanging.srcdoc = "<img src=\"pending-image\">"
    document.body.append(hanging)
  })
  const paragraph = page.locator("p")
  await paragraph.focus()
  await paragraph.hover()
  await page.keyboard.press("Backquote")
  await paragraph.locator(wrapper).waitFor({ timeout: 5000 })
  // The wrapper first holds a spinner. Its answer moves the content below.
  await paragraph.locator(".readomi-spinner").waitFor({ state: "detached", timeout: 5000 })
  const child = page.frameLocator("iframe[src=first]").locator("p")
  await child.evaluate(element => element.style.marginTop = "145px")
  await child.hover()
  await page.keyboard.press("Backquote")
  await child.locator(wrapper).waitFor({ timeout: 5000 })
  await child.locator(".readomi-spinner").waitFor({ state: "detached", timeout: 5000 })
  const rotated = page.frameLocator("iframe[src=first]").locator("section")
  await page.locator("iframe[src=first]").evaluate((frame) => {
    frame.style.transform = "rotate(12deg) scale(.6)"
  })
  await rotated.hover()
  await page.keyboard.press("Backquote")
  await rotated.locator(wrapper).waitFor({ timeout: 5000 })
})
