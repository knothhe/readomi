/* global chrome -- callbacks run inside the extension worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure, storedConfig } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

let context
let service
const URL = "https://www.youtube.com/watch?v=page-state-one"
const LABEL = "Video subtitle translation"

afterEach(async (test) => {
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
    context = service = undefined
  }
})

async function waitFor(read, predicate, description) {
  const deadline = Date.now() + 15_000
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value))
      return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${description}: ${JSON.stringify(value)}`)
}

async function openPopup(host, extensionId, test) {
  const popupUrl = `chrome-extension://${extensionId}/popup.html`
  const next = context.waitForEvent("page")
  const target = await context.serviceWorkers()[0].evaluate(async ({ url, popupUrl }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)
    await chrome.tabs.update(tab.id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    await chrome.tabs.create({ windowId: tab.windowId, url: popupUrl, active: false })
    return tab.id
  }, { url: host.url(), popupUrl })
  const popup = await next
  await popup.waitForURL(popupUrl)
  const toggle = popup.getByRole("switch", { name: LABEL, exact: true })
  await waitFor(() => toggle.isEnabled(), Boolean, "popup subtitle switch unavailable")
  const active = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id)
  assert.equal(active, target, "popup must read the real active website tab")
  test.diagnostic(`inactive popup.html queried active host ${target}; native toolbar opening is not covered`)
  return popup
}

async function playerReader(page) {
  const cdp = await context.newCDPSession(page)
  const nodes = node => [node, ...(node.children ?? []).flatMap(nodes), ...(node.shadowRoots ?? []).flatMap(nodes)]
  const attr = (node, name) => {
    const index = node.attributes?.indexOf(name) ?? -1
    return index < 0 ? undefined : node.attributes[index + 1]
  }
  return {
    async read() {
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
      const all = nodes(root)
      const toggle = all.find(node => attr(node, "class") === "toggle")
      return { toggle, enabled: attr(toggle ?? {}, "aria-pressed"), layers: all.filter(node => attr(node, "data-readomi-subtitles") !== undefined).length }
    },
    async click() {
      const { toggle } = await this.read()
      assert.ok(toggle, "native player switch missing")
      const { model } = await cdp.send("DOM.getBoxModel", { nodeId: toggle.nodeId })
      const [x1, y1, x2, , , y2] = model.content
      await page.mouse.click((x1 + x2) / 2, (y1 + y2) / 2)
    },
  }
}

async function expectState(popup, reader, enabled) {
  const toggle = popup.getByRole("switch", { name: LABEL, exact: true })
  await waitFor(async () => ({ popup: await toggle.getAttribute("aria-checked"), pending: !await toggle.isEnabled(), player: await reader.read() }), state => state.popup === String(enabled) && !state.pending && state.player.enabled === String(enabled) && state.player.layers === Number(enabled), "popup, player and subtitle renderer disagree")
}

it("synchronizes shortcut, popup and player without changing the default or another tab", async (test) => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    Object.assign(config.features, { videoSubtitles: false, videoControls: true, disabledSites: [], videoExcludedSites: [] })
    config.ui.language = "en"
    await chrome.storage.local.set({ config })
  })
  await context.route("https://www.youtube.com/**", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Page subtitle state</title><style>body{margin:24px;font:16px system-ui}.html5-video-player{position:relative;width:800px;height:450px;background:#302b29}video{width:800px;height:450px}.ytp-chrome-bottom{position:absolute;bottom:0;left:0;width:800px;height:48px;display:flex;justify-content:space-between;background:#0007}.ytp-left-controls,.ytp-right-controls{display:flex;height:48px;align-items:center}.ytp-right-controls button{height:48px;width:48px}</style><h1>Subtitle switch test</h1><div id="movie_player" class="html5-video-player"><video></video><div class="ytp-chrome-bottom"><div class="ytp-left-controls"><button>Play</button></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button><button class="ytp-fullscreen-button">Full screen</button></div></div></div><script>const video=document.querySelector('video');const track=video.addTextTrack('subtitles','English','en');track.mode='showing';track.addCue(new VTTCue(0,60,'Shared page subtitle sentence.'));</script></html>`,
  }))
  const host = await context.newPage()
  await host.goto(URL)
  const reader = await playerReader(host)
  await waitFor(() => reader.read(), state => state.enabled === "false", "player control did not mount")
  const other = await context.newPage()
  await other.goto(URL.replace("one", "two"))
  const otherReader = await playerReader(other)
  await waitFor(() => otherReader.read(), state => state.enabled === "false", "other tab did not use default")
  let popup = await openPopup(host, launched.extensionId, test)
  await expectState(popup, reader, false)

  await host.bringToFront()
  await host.locator("h1").click()
  await host.keyboard.press("Alt+V")
  await expectState(popup, reader, true)
  assert.equal((await storedConfig(context)).features.videoSubtitles, false)
  assert.equal((await otherReader.read()).enabled, "false")

  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await expectState(popup, reader, false)
  await host.bringToFront()
  await reader.click()
  await expectState(popup, reader, true)
  await popup.close()
  popup = await openPopup(host, launched.extensionId, test)
  await expectState(popup, reader, true)
  await popup.getByRole("switch", { name: LABEL, exact: true }).press("Alt+V")
  await expectState(popup, reader, false)
  await popup.getByRole("switch", { name: LABEL, exact: true }).press("Alt+V")
  await expectState(popup, reader, true)
  await popup.locator("#root").screenshot({ path: "/tmp/readomi-popup-page-subtitles-on.png" })
  await popup.close()

  await host.reload()
  await waitFor(() => reader.read(), state => state.enabled === "false" && state.layers === 0, "refresh did not restore saved default")
  popup = await openPopup(host, launched.extensionId, test)
  await expectState(popup, reader, false)
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await expectState(popup, reader, true)
  const siteSwitch = popup.getByRole("switch", { name: "Disable extension on this site", exact: true })
  await siteSwitch.click()
  await waitFor(() => reader.read(), state => !state.toggle && state.layers === 0, "website disabling did not stop the subtitle runtime")
  await waitFor(() => siteSwitch.isEnabled(), Boolean, "website disable did not settle")
  await siteSwitch.click()
  await expectState(popup, reader, true)
  const exclude = excluded => context.serviceWorkers()[0].evaluate(async (excluded) => {
    const { config } = await chrome.storage.local.get("config")
    config.features.videoExcludedSites = excluded ? [{ type: "domain", value: "youtube.com" }] : []
    await chrome.storage.local.set({ config })
  }, excluded)
  await exclude(true)
  await waitFor(() => reader.read(), state => !state.toggle && state.layers === 0, "video exclusion did not remove player controls")
  await waitFor(async () => ({ enabled: await popup.getByRole("switch", { name: LABEL, exact: true }).isEnabled(), checked: await popup.getByRole("switch", { name: LABEL, exact: true }).getAttribute("aria-checked") }), state => !state.enabled && state.checked === "false", "excluded page remained switchable")
  await exclude(false)
  await expectState(popup, reader, false)
  assert.equal((await storedConfig(context)).features.videoSubtitles, false)
  assert.equal((await otherReader.read()).enabled, "false")
})

it("restores page defaults in a surviving cross-origin iframe after SPA navigation", async (test) => {
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await settings.goto(`chrome-extension://${launched.extensionId}/options.html`)
  await settings.waitForFunction(async () => Boolean((await chrome.storage.local.get("config")).config))
  await settings.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    Object.assign(config.features, { videoSubtitles: false, disabledSites: [], videoExcludedSites: [] })
    config.ui.language = "en"
    await chrome.storage.local.set({ config })
  })
  const origin = "https://browse.library.kiwix.org"
  const embed = "https://embedded.example/player"
  const video = "<video style='width:320px;height:180px'></video>"
  // Kiwix injects the full runtime into cross-origin frames without page translation.
  await context.route(`${origin}/**`, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><body><h1>SPA subtitle state</h1>${video}<iframe src="${embed}"></iframe></body></html>`,
  }))
  await context.route(embed, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>${video}</body></html>` }))
  const host = await context.newPage()
  await host.goto(`${origin}/a`)
  const frame = host.frames().find(frame => frame.url() === embed)
  assert.ok(frame, "cross-origin fixture frame missing")
  await frame.evaluate(() => {
    window.e2eFrameIdentity = "surviving-frame"
  })
  const layers = async () => ({ top: await host.locator("[data-readomi-subtitles]").count(), frame: await frame.locator("[data-readomi-subtitles]").count() })
  let popup = await openPopup(host, launched.extensionId, test)
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await waitFor(layers, state => state.top === 1 && state.frame === 1, "page choice did not reach the iframe")

  await host.evaluate(() => history.pushState({}, "", "/b"))
  await waitFor(layers, state => state.top === 0 && state.frame === 0, "SPA navigation left the iframe using the previous page choice")
  assert.equal(await frame.evaluate(() => window.e2eFrameIdentity), "surviving-frame", "iframe must survive navigation")
  await popup.close()
  popup = await openPopup(host, launched.extensionId, test)
  assert.equal(await popup.getByRole("switch", { name: LABEL, exact: true }).getAttribute("aria-checked"), "false")

  await settings.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.videoSubtitles = true
    await chrome.storage.local.set({ config })
  })
  await waitFor(layers, state => state.top === 1 && state.frame === 1, "new default did not enable both runtimes")
  await waitFor(() => popup.getByRole("switch", { name: LABEL, exact: true }).getAttribute("aria-checked"), value => value === "true", "popup did not follow the new default")
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await waitFor(layers, state => state.top === 0 && state.frame === 0, "manual disable did not reach both runtimes")
  await popup.close()
  await host.evaluate(() => history.replaceState({}, "", "/c"))
  await waitFor(layers, state => state.top === 1 && state.frame === 1, "SPA navigation did not restore the enabled default in both runtimes")
  popup = await openPopup(host, launched.extensionId, test)
  assert.equal(await popup.getByRole("switch", { name: LABEL, exact: true }).getAttribute("aria-checked"), "true")
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await waitFor(layers, state => state.top === 0 && state.frame === 0, "manual disable before Back did not reach both runtimes")
  await popup.close()
  await host.goBack()
  await waitFor(layers, state => state.top === 1 && state.frame === 1, "Back navigation did not restore the enabled default in both runtimes")
  assert.equal(await frame.evaluate(() => window.e2eFrameIdentity), "surviving-frame", "iframe must survive Back navigation")
})
