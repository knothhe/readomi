/* global chrome -- browser API callbacks run in the extension worker or popup. */
import assert from "node:assert/strict"
import process from "node:process"
import { afterEach, it } from "node:test"
import { configureService, extensionPath, launchBrowser, reportFailure, storedConfig } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

const LABEL = "Disable extension on this site"
const HOST = "video.popup-video.test"
const HOST_URL = `https://${HOST}/watch/one`
const CHILD_URL = `https://sub.${HOST}/watch/child`
const RETAINED = [{ type: "domain", value: "retained.example" }, { type: "pattern", value: "*://elsewhere.test/watch/*" }]
let context
let service
let previousAttachToOther
const popupProofs = new Set()

afterEach(async (test) => {
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
    context = service = undefined
    popupProofs.clear()
    if (previousAttachToOther === undefined)
      delete process.env.PW_CHROMIUM_ATTACH_TO_OTHER
    else
      process.env.PW_CHROMIUM_ATTACH_TO_OTHER = previousAttachToOther
  }
})

async function waitFor(read, predicate, description) {
  const deadline = Date.now() + 15_000
  let state
  while (Date.now() < deadline) {
    state = await read()
    if (predicate(state))
      return state
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${description}: ${JSON.stringify(state)}`)
}

async function writeFeatures(patch) {
  await context.serviceWorkers()[0].evaluate(async (patch) => {
    const { config } = await chrome.storage.local.get("config")
    Object.assign(config.features, patch)
    await chrome.storage.local.set({ config })
  }, patch)
}

async function prepare() {
  // Playwright 1.63 attaches Chromium's extension popup targets as Pages with
  // this flag. Keep it local to this test process; ordinary tabs remain tabs.
  previousAttachToOther = process.env.PW_CHROMIUM_ATTACH_TO_OTHER
  process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1"
  service = await startFakeService()
  const launched = await launchBrowser({ extension: process.env.E2E_EXTENSION_PATH || extensionPath })
  context = launched.context
  const popupUrl = `chrome-extension://${launched.extensionId}/popup.html`
  await context.addInitScript((popupUrl) => {
    if (location.href !== popupUrl)
      return
    window.e2eActiveTabQueries = []
    const original = chrome.tabs.query.bind(chrome.tabs)
    const record = (query, tabs) => {
      if (query.active && query.currentWindow)
        window.e2eActiveTabQueries.push(tabs.map(({ id, url }) => ({ id, url })))
      return tabs
    }
    // Observe the real API result without replacing the selected tab or URL.
    chrome.tabs.query = (query, callback) => callback
      ? original(query, tabs => callback(record(query, tabs)))
      : original(query).then(tabs => record(query, tabs))
  }, popupUrl)
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  await writeFeatures({ videoSubtitles: true, hoverTranslation: true, videoExcludedSites: RETAINED, disabledSites: [] })
  await context.route(/^https:\/\/(?:video|sub\.video|frame)\.popup-video\.test\//, (route) => {
    const child = new URL(route.request().url()).hostname !== HOST
    const cue = child ? "Popup child sentence." : "Popup main sentence."
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Popup video exclusion host</title><style>body{margin:24px;font:16px system-ui}video{display:block;width:640px;height:360px;background:#302b29}</style><h1>Website disabling test article with enough English words to translate.</h1><p>This page should return to its original text when disabled.</p><textarea id="draft"></textarea>${child ? "" : "<iframe id=\"embedded\" src=\"https://frame.popup-video.test/watch/frame\"></iframe>"}<video controls></video><script>const video=document.querySelector('video');const track=video.addTextTrack('subtitles','English','en');track.mode='showing';track.addCue(new VTTCue(0,60,${JSON.stringify(cue)}));window.e2eTrack=track;</script></html>`,
    })
  })
  const host = await context.newPage()
  await host.goto(HOST_URL)
  return { ...launched, host, popupUrl }
}

async function openPopup(host, popupUrl, test) {
  const worker = context.serviceWorkers()[0]
  const target = await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)
    if (!tab?.id)
      throw new Error(`host tab not found: ${url}`)
    await chrome.tabs.update(tab.id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
    return { id: tab.id, url: tab.url, windowId: tab.windowId, activeId: active?.id, activeUrl: active?.url }
  }, host.url())
  assert.equal(target.activeId, target.id)
  assert.equal(target.activeUrl, target.url)
  let popup = null
  let outcome = "macOS headless Chromium crashes with SIGSEGV when opening an action popup"
  // This installed macOS headless Chromium crashes inside openPopup rather
  // than rejecting it. Do not repeat that native path on this platform.
  if (process.platform !== "darwin") {
    const realPage = context.waitForEvent("page", { timeout: 4000 }).catch(() => null)
    outcome = await worker.evaluate(async (windowId) => {
      try {
        await chrome.action.openPopup({ windowId })
        return null
      }
      catch (error) {
        return String(error)
      }
    }, target.windowId)
    popup = await realPage
  }
  let mode = "chrome.action.openPopup"
  if (!popup || outcome) {
    if (popup)
      await popup.close()
    // A popup target unsupported by the driver must not remain beside the
    // fallback. Close only this extension's popup, never the host tab.
    const cdp = await context.newCDPSession(host)
    const { targetInfos } = await cdp.send("Target.getTargets")
    for (const info of targetInfos.filter(info => info.url === popupUrl))
      await cdp.send("Target.closeTarget", { targetId: info.targetId })
    await cdp.detach()
    const nextPage = context.waitForEvent("page", { timeout: 5000 })
    await worker.evaluate(async ({ windowId, url }) => chrome.tabs.create({ windowId, url, active: false }), { windowId: target.windowId, url: popupUrl })
    popup = await nextPage
    mode = "inactive popup.html tab"
    if (!popupProofs.has(mode)) {
      popupProofs.add(mode)
      test.diagnostic(`popup fallback (${outcome || "no controllable action popup target"}); toolbar opening/user gesture is not covered by this fallback`)
    }
  }
  await popup.waitForURL(popupUrl)
  await popup.getByRole("switch", { name: /Disable extension on this site|在此网站禁用扩展/, exact: true }).waitFor()
  await waitFor(() => popup.evaluate(() => window.e2eActiveTabQueries), queries => queries?.some(tabs => tabs.some(tab => tab.id === target.id && tab.url === target.url)), "popup bootstrap did not query the actual active host tab")
  const proof = `${mode} queried host tab ${target.id}: ${target.url}`
  if (!popupProofs.has(proof)) {
    popupProofs.add(proof)
    test.diagnostic(proof)
  }
  return popup
}

async function closePopup(popup) {
  if (!popup.isClosed())
    await popup.close()
}

async function captionReader(page) {
  const cdp = await context.newCDPSession(page)
  const attr = (node, name) => {
    const index = node.attributes?.indexOf(name) ?? -1
    return index < 0 ? undefined : node.attributes[index + 1]
  }
  const nodes = node => [node, ...(node.children ?? []).flatMap(nodes), ...(node.shadowRoots ?? []).flatMap(nodes)]
  const text = node => !node ? "" : node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join("")
  return async () => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    return nodes(root).filter(node => attr(node, "data-readomi-subtitles") !== undefined).map(host => text(nodes(host).find(node => attr(node, "class") === "translated")))
  }
}

async function expectSwitch(popup, checked, label = LABEL) {
  const toggle = popup.getByRole("switch", { name: label, exact: true })
  await waitFor(async () => ({ checked: await toggle.getAttribute("aria-checked"), disabled: await toggle.isDisabled() }), state => state.checked === String(checked) && !state.disabled, "website switch did not settle")
  return toggle
}

async function triggerInput(frame, keyboard) {
  await frame.locator("#draft").fill("Translate this input sentence.")
  await frame.locator("#draft").press("End")
  for (let index = 0; index < 3; index++)
    await keyboard.press("Space")
}

it("disables every feature on the active hostname and its embedded frames, persists across reloads and resumes", async (test) => {
  const { host, popupUrl } = await prepare()
  const child = await context.newPage()
  await child.goto(CHILD_URL)
  const embedded = host.frameLocator("#embedded")
  await embedded.locator("#draft").waitFor()
  const readHost = await captionReader(host)
  const readChild = await captionReader(child)
  await waitFor(readHost, captions => captions.some(text => text.includes("【译】")), "host subtitles did not start")
  await triggerInput(embedded, host.keyboard)
  await waitFor(() => embedded.locator("#draft").inputValue(), text => text.includes("【译】"), "embedded input translation did not start")
  let popup = await openPopup(host, popupUrl, test)
  assert.equal(await popup.getByRole("switch", { name: "Exclude this site from video translation", exact: true }).count(), 0)
  await popup.getByRole("button", { name: "Translate this page", exact: true }).click()
  await waitFor(() => host.locator("h1").textContent(), text => text.includes("【译】"), "page translation did not start")
  const original = await storedConfig(context)
  let toggle = await expectSwitch(popup, false)
  await toggle.click()
  await expectSwitch(popup, true)
  await waitFor(() => storedConfig(context), config => config.features.disabledSites.includes(HOST), "website setting was not saved")
  assert.deepEqual(await storedConfig(context), { ...original, features: { ...original.features, disabledSites: [HOST] } })
  assert.equal(await popup.getByRole("button", { name: "Translate this page", exact: true }).count(), 0)
  await waitFor(readHost, captions => captions.length === 0, "disabled host subtitles were not removed")
  assert.equal(await host.evaluate(() => window.e2eTrack.mode), "showing")
  await waitFor(() => host.locator("h1").textContent(), text => !text.includes("【译】"), "translated page did not return to original text")
  await waitFor(() => embedded.locator("[data-readomi-host-toast]").count(), count => count === 0, "embedded runtime stayed mounted")
  await triggerInput(embedded, host.keyboard)
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(await embedded.locator("#draft").inputValue(), "Translate this input sentence.   ")
  await waitFor(readChild, captions => captions.some(text => text.includes("【译】")), "another hostname was incorrectly disabled")
  await closePopup(popup)
  await host.reload()
  await host.locator("video").waitFor()
  assert.equal(await host.locator("[data-readomi-host-toast]").count(), 0)
  assert.equal((await readHost()).length, 0)
  popup = await openPopup(host, popupUrl, test)
  toggle = await expectSwitch(popup, true)
  await toggle.click()
  await expectSwitch(popup, false)
  await waitFor(readHost, captions => captions.some(text => text.includes("【译】")), "reenabling did not restore subtitles")
  await triggerInput(host.frameLocator("#embedded"), host.keyboard)
  await waitFor(() => host.frameLocator("#embedded").locator("#draft").inputValue(), text => text.includes("【译】"), "reenabling did not restore embedded input translation")
  assert.deepEqual(await storedConfig(context), original)
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.ui.language = "zh-CN"
    await chrome.storage.local.set({ config })
  })
  await popup.getByRole("switch", { name: "在此网站禁用扩展", exact: true }).waitFor()
  await popup.locator("#root").screenshot({ path: "/tmp/readomi-popup-site-enabled.png" })
  await popup.getByRole("switch", { name: "在此网站禁用扩展", exact: true }).click()
  await expectSwitch(popup, true, "在此网站禁用扩展")
  await popup.locator("#root").screenshot({ path: "/tmp/readomi-popup-site-disabled.png" })
})
