/* global chrome -- callbacks run inside the extension worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure, storedConfig, waitForStoredConfig } from "./browser.mjs"
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

async function expectState(popup, reader, enabled, playerEnabled = enabled) {
  const toggle = popup.getByRole("switch", { name: LABEL, exact: true })
  await waitFor(async () => ({ popup: await toggle.getAttribute("aria-checked"), pending: !await toggle.isEnabled(), player: await reader.read() }), state => state.popup === String(enabled) && !state.pending && state.player.enabled === String(playerEnabled) && state.player.layers === Number(playerEnabled), "domain preference or video display did not settle")
}

it("persists the YouTube domain choice across tabs and navigation while player switches affect one video", async (test) => {
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
  await context.route(/^https:\/\/(?:www\.youtube\.com|www\.youtube-nocookie\.com)\//, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Domain subtitle state</title><style>body{margin:24px;font:16px system-ui}.html5-video-player{position:relative;width:800px;height:450px;background:#302b29}video{width:800px;height:450px}.ytp-chrome-bottom{position:absolute;bottom:0;left:0;width:800px;height:48px;display:flex;justify-content:space-between;background:#0007}.ytp-left-controls,.ytp-right-controls{display:flex;height:48px;align-items:center}.ytp-right-controls button{height:48px;width:48px}</style><h1>Subtitle switch test</h1><div id="movie_player" class="html5-video-player"><video></video><div class="ytp-chrome-bottom"><div class="ytp-left-controls"><button>Play</button></div><div class="ytp-right-controls"><button class="ytp-settings-button">Settings</button><button class="ytp-fullscreen-button">Full screen</button></div></div></div><script>const video=document.querySelector('video');const track=video.addTextTrack('subtitles','English','en');track.mode='showing';track.addCue(new VTTCue(0,60,'Shared domain subtitle sentence.'));</script></html>`,
  }))
  const host = await context.newPage()
  await host.goto(URL)
  const reader = await playerReader(host)
  await waitFor(() => reader.read(), state => state.enabled === "false", "player control did not mount")
  const other = await context.newPage()
  await other.goto(URL.replace("one", "two"))
  const otherReader = await playerReader(other)
  await waitFor(() => otherReader.read(), state => state.enabled === "false", "other tab did not use default")
  const unrelated = await context.newPage()
  await unrelated.goto("https://www.youtube-nocookie.com/embed/other-domain")
  const unrelatedReader = await playerReader(unrelated)
  await waitFor(() => unrelatedReader.read(), state => state.enabled === "false", "unrelated domain did not use default")
  let popup = await openPopup(host, launched.extensionId, test)
  await expectState(popup, reader, false)

  await host.bringToFront()
  await host.locator("h1").click()
  await host.keyboard.press("Alt+V")
  await expectState(popup, reader, true)
  await waitFor(() => otherReader.read(), state => state.enabled === "true" && state.layers === 1, "domain choice did not reach the other tab")
  assert.equal((await unrelatedReader.read()).enabled, "false")
  assert.equal((await storedConfig(context)).features.videoSubtitles, false)

  await reader.click()
  await expectState(popup, reader, true, false)
  assert.equal((await otherReader.read()).enabled, "true", "player choice must leave the other video alone")
  await popup.close()
  popup = await openPopup(host, launched.extensionId, test)
  await expectState(popup, reader, true, false)
  await popup.close()

  await host.reload()
  await waitFor(() => reader.read(), state => state.enabled === "true" && state.layers === 1, "refresh did not preserve domain preference")
  await reader.click()
  await waitFor(() => reader.read(), state => state.enabled === "false" && state.layers === 0, "player did not switch off")
  await host.evaluate(() => history.pushState({}, "", "/watch?v=next-video"))
  await waitFor(() => reader.read(), state => state.enabled === "true" && state.layers === 1, "next video inherited the previous video override")
  popup = await openPopup(host, launched.extensionId, test)
  await expectState(popup, reader, true)
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await expectState(popup, reader, false)
  await waitFor(() => otherReader.read(), state => state.enabled === "false" && state.layers === 0, "domain disable did not reach the other tab")
  await host.bringToFront()
  await reader.click()
  await expectState(popup, reader, false, true)
  assert.equal((await otherReader.read()).enabled, "false")
  await popup.getByRole("switch", { name: LABEL, exact: true }).press("Alt+V")
  await expectState(popup, reader, true)

  const siteSwitch = popup.getByRole("switch", { name: "Disable extension on this site", exact: true })
  await siteSwitch.click()
  await waitFor(() => reader.read(), state => !state.toggle && state.layers === 0, "website disabling did not stop subtitles")
  await waitFor(() => siteSwitch.isEnabled(), Boolean, "website disable did not settle")
  await siteSwitch.click()
  await expectState(popup, reader, true)
  const exclude = excluded => context.serviceWorkers()[0].evaluate(async (excluded) => {
    const { config } = await chrome.storage.local.get("config")
    config.features.videoExcludedSites = excluded ? [{ type: "domain", value: "youtube.com" }] : []
    await chrome.storage.local.set({ config })
  }, excluded)
  await exclude(true)
  await waitFor(() => reader.read(), state => !state.toggle && state.layers === 0, "video exclusion did not remove controls")
  await waitFor(() => popup.getByRole("switch", { name: LABEL, exact: true }).isEnabled(), enabled => !enabled, "excluded site remained switchable")
  await exclude(false)
  await expectState(popup, reader, true)
  assert.equal((await storedConfig(context)).features.videoSubtitles, false)
  assert.equal((await unrelatedReader.read()).enabled, "false")
})

it("keeps the domain preference in surviving cross-origin frames after SPA navigation", async (test) => {
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await settings.goto(`chrome-extension://${launched.extensionId}/options.html`)
  await waitForStoredConfig(context, config => Boolean(config))
  await settings.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    Object.assign(config.features, { videoSubtitles: false, disabledSites: [], videoExcludedSites: [] })
    config.ui.language = "en"
    await chrome.storage.local.set({ config })
  })
  const origin = "https://browse.library.kiwix.org"
  const embed = "https://embedded.example/player"
  const video = "<video style='width:320px;height:180px'></video>"
  await context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><h1>SPA subtitle state</h1>${video}<iframe src="${embed}"></iframe></body></html>` }))
  await context.route(embed, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>${video}</body></html>` }))
  const host = await context.newPage()
  await host.goto(`${origin}/a`)
  const frame = host.frames().find(frame => frame.url() === embed)
  assert.ok(frame, "cross-origin fixture frame missing")
  await frame.evaluate(() => {
    window.e2eFrameIdentity = "surviving-frame"
  })
  const layers = async () => {
    const embedded = host.frames().find(frame => frame.url() === embed)
    return { top: await host.locator("[data-readomi-subtitles]").count(), frame: embedded ? await embedded.locator("[data-readomi-subtitles]").count() : -1 }
  }
  let popup = await openPopup(host, launched.extensionId, test)
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await waitFor(layers, state => state.top === 1 && state.frame === 1, "domain choice did not reach the iframe")
  await popup.close()
  await host.evaluate(() => history.pushState({}, "", "/b"))
  await waitFor(layers, state => state.top === 1 && state.frame === 1, "SPA navigation discarded domain preference")
  assert.equal(await frame.evaluate(() => window.e2eFrameIdentity), "surviving-frame")
  popup = await openPopup(host, launched.extensionId, test)
  await waitFor(() => popup.getByRole("switch", { name: LABEL, exact: true }).getAttribute("aria-checked"), value => value === "true", "popup did not keep the domain choice")
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await waitFor(layers, state => state.top === 0 && state.frame === 0, "domain disable did not reach both frames")
  await popup.close()
  await host.goBack()
  await waitFor(layers, state => state.top === 0 && state.frame === 0, "Back navigation discarded the disabled domain choice")
  await host.reload()
  await waitFor(layers, state => state.top === 0 && state.frame === 0, "refresh discarded the disabled domain choice")
})

it("keeps X player choices separate while the domain switch survives other posts", async (test) => {
  const launched = await launchBrowser()
  context = launched.context
  await launched.page.goto(`chrome-extension://${launched.extensionId}/options.html`)
  await waitForStoredConfig(context, config => Boolean(config))
  await launched.page.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    Object.assign(config.features, { videoSubtitles: false, videoControls: true, disabledSites: [], videoExcludedSites: [] })
    config.ui.language = "en"
    await chrome.storage.local.set({ config })
  })
  await context.route("https://x.com/**", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>X domain and video switches</title><style>body{background:#111;color:white;font:16px system-ui}article{width:640px;margin:12px}article>div{position:relative;width:640px;height:250px;background:#302b29}video{width:100%;height:100%}.controls{position:absolute;bottom:0;width:100%;height:40px;display:flex;align-items:center;justify-content:space-between;background:#0009}button{color:white;background:#333;border:0;padding:8px}</style><h1>X scope test</h1>${[100, 200].map((id, index) => `<article><a href="https://x.com/readomi/status/${id}"><time>Today</time></a><div data-testid="videoComponent"><video></video><div class="controls" data-testid="videoControls"><button aria-label="Pause ${index ? "reply" : "main"}">Ⅱ</button><button aria-label="Fullscreen ${id}">⛶</button></div></div></article>`).join("")}<script>document.querySelectorAll('video').forEach((video,index)=>{const track=video.addTextTrack('subtitles','English','en');track.mode='showing';track.addCue(new VTTCue(0,60,'Video '+index));});</script></html>`,
  }))
  const host = await context.newPage()
  await host.goto("https://x.com/readomi/status/100")
  const reader = await playerReader(host)
  await waitFor(() => reader.read(), state => state.enabled === "false", "X controls missing")
  let popup = await openPopup(host, launched.extensionId, test)
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await expectState(popup, reader, true)
  await host.bringToFront()
  await reader.click()
  await expectState(popup, reader, true, false)
  await host.getByRole("button", { name: "Pause reply", exact: true }).click()
  await expectState(popup, reader, true)
  const modes = () => host.evaluate(() => Array.from(document.querySelectorAll("video"), video => video.textTracks[0].mode))
  await waitFor(modes, value => value[0] === "showing" && value[1] === "hidden", "reply inherited the main video's choice")
  await host.getByRole("button", { name: "Pause main", exact: true }).click()
  await expectState(popup, reader, true, false)
  await popup.close()
  await host.goto("https://x.com/readomi/status/200")
  await waitFor(() => reader.read(), state => state.enabled === "true" && state.layers === 1, "another X post discarded the domain choice")
  popup = await openPopup(host, launched.extensionId, test)
  await expectState(popup, reader, true)
  await popup.getByRole("switch", { name: LABEL, exact: true }).click()
  await expectState(popup, reader, false)
  await popup.close()
  await host.goto("https://x.com/readomi/status/100")
  await waitFor(() => reader.read(), state => state.enabled === "false" && state.layers === 0, "another post discarded the disabled domain choice")
  assert.equal((await storedConfig(context)).features.videoSubtitles, false)
})
