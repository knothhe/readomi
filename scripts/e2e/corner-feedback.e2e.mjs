/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure } from "./browser.mjs"
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
  }
})

async function settled(locator) {
  await locator.waitFor()
  await locator.evaluate(element => new Promise((resolve) => {
    function check() {
      if (getComputedStyle(element).opacity === "1")
        resolve()
      else
        requestAnimationFrame(check)
    }
    check()
  }))
}

it("shares one right-bottom dock across content scripts, fades without movement and keeps notifications clear of the adaptation panel", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  const worker = context.serviceWorkers()[0]
  await worker.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.ui.language = "zh-CN"
    config.appearance.mode = "light"
    for (const provider of config.providersConfig) {
      provider.apiKey = ""
      provider.noApiKey = false
    }
    await chrome.storage.local.set({ config })
  })
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${service.origin}/article`)
  await page.locator("[data-readomi-site-rule-panel]").waitFor({ state: "attached" })
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", "<textarea id=\"corner-draft\" aria-label=\"Draft\"></textarea>")
  })
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url })
    await chrome.tabs.sendMessage(tab.id, { kind: "readomi-message", type: "openSiteRulePanel" })
  }, page.url())
  const panel = page.locator(".site-rule-panel")
  await settled(panel)
  const initial = await panel.boundingBox()
  assert.equal(initial.x + initial.width, 1260)
  assert.equal(initial.y + initial.height, 880)

  async function trigger() {
    const field = page.locator("#corner-draft")
    await field.fill("A small reading habit.")
    await field.press("End")
    for (let index = 0; index < 3; index++)
      await page.keyboard.press("Space")
    const notice = page.locator(".readomi-toast-card")
    await settled(notice)
    return notice
  }
  const notice = await trigger()
  await notice.hover() // Pause the four-second timer while measuring and taking screenshots.
  const box = await notice.boundingBox()
  assert.equal(box.x + box.width, 1260)
  assert.equal(box.width, 356)
  assert.equal(initial.y - box.y - box.height, 8)
  assert.deepEqual(await panel.boundingBox(), initial)
  assert.equal(await page.locator("[data-readomi-corner-host]").count(), 1)
  assert.ok(await page.locator("[data-readomi-host-toast]").count() >= 2)
  await page.screenshot({ path: "/tmp/readomi-corner-implementation-desktop.png" })

  await notice.evaluate((element) => {
    globalThis.cornerFadeSamples = []
    function sample() {
      if (!element.isConnected)
        return
      const style = getComputedStyle(element)
      globalThis.cornerFadeSamples.push({ opacity: Number(style.opacity), transform: style.transform, inert: element.inert })
      requestAnimationFrame(sample)
    }
    sample()
  })
  await notice.getByRole("button").click()
  await notice.waitFor({ state: "detached" })
  const samples = await page.evaluate(() => globalThis.cornerFadeSamples)
  assert.ok(samples.some(sample => sample.opacity > 0 && sample.opacity < 1), "fade has intermediate opacity frames")
  assert.ok(samples.every(sample => sample.transform === "none"), "fade never translates or scales")
  assert.ok(samples.some(sample => sample.inert), "exiting controls become inert before removal")
  assert.deepEqual(await panel.boundingBox(), initial)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileNotice = await trigger()
  await mobileNotice.hover()
  const mobilePanel = await panel.boundingBox()
  const mobileBox = await mobileNotice.boundingBox()
  assert.equal(mobilePanel.x + mobilePanel.width, 378)
  assert.equal(mobilePanel.y + mobilePanel.height, 832)
  assert.equal(mobilePanel.y - mobileBox.y - mobileBox.height, 8)
  assert.equal(mobileBox.x + mobileBox.width, 378)
  assert.ok(mobileBox.x >= 12)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
  await page.screenshot({ path: "/tmp/readomi-corner-implementation-mobile.png" })
  await mobileNotice.getByRole("button").click()
  await mobileNotice.waitFor({ state: "detached" })
  await panel.getByRole("button", { name: "收起", exact: true }).click()
  const folded = page.locator(".site-rule-folded")
  await settled(folded)
  const foldedBox = await folded.boundingBox()
  assert.equal(foldedBox.x + foldedBox.width, 378)
  assert.equal(foldedBox.y + foldedBox.height, 832)
  await folded.getByRole("button", { name: "展开适配面板", exact: true }).click()
  await settled(panel)
  await panel.getByRole("button", { name: "关闭", exact: true }).click()
  await panel.waitFor({ state: "detached" })
  await trigger()
  const orphanBox = await page.locator(".readomi-toast-card").boundingBox()
  assert.equal(orphanBox.y + orphanBox.height, 832, "empty panel and toast roots reserve no space")

  await page.locator(".readomi-toast-card").getByRole("button").click()
  await page.locator(".readomi-toast-card").waitFor({ state: "detached" })
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url })
    await chrome.tabs.sendMessage(tab.id, { kind: "readomi-message", type: "openSiteRulePanel" })
  }, page.url())
  await settled(folded)
  await folded.getByRole("button", { name: "展开适配面板", exact: true }).click()
  await settled(panel)
  await panel.locator("summary").click()
  await panel.locator("#readomi-rule-document").fill(JSON.stringify({
    format: "readomi-site-rule",
    version: 1,
    site: { hosts: ["127.0.0.1"] },
    changes: [{ action: "upsert", rule: { id: "corner-motion-test", matches: "127.0.0.1", includeSelectors: ["p"] } }],
  }))
  await panel.getByTestId("readomi-rule-preview-action").click()
  await panel.getByTestId("readomi-rule-save-action").click()
  const saved = page.locator(".site-rule-saved")
  await settled(saved)
  await saved.hover()
  assert.equal(await saved.locator("strong").textContent(), "站点规则已保存")
  const savedBox = await saved.boundingBox()
  assert.equal(savedBox.width, 280)
  assert.equal(savedBox.y + savedBox.height, 832)
  await saved.getByRole("button", { name: "撤销", exact: true }).click()
  await saved.getByText("已撤销本次修改", { exact: true }).waitFor()
  await settled(saved)
  await page.mouse.move(0, 0)
  await saved.waitFor({ state: "detached", timeout: 5000 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  const reducedNotice = await trigger()
  assert.equal(await reducedNotice.evaluate(element => getComputedStyle(element).transform), "none")
  await reducedNotice.getByRole("button").click()
  await reducedNotice.waitFor({ state: "detached" })
})
