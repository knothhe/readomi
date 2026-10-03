/* global chrome -- settings callbacks run in the extension page. */
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
  }
})

it("X HTML5 subtitles scale with the video window and support live fixed sizing without losing translations", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await configureService(settings, launched.extensionId, setupDocumentFor(service.origin))
  await settings.getByRole("link", { name: "Video subtitles", exact: true }).click()
  await settings.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  const modes = settings.getByRole("group", { name: "Size mode", exact: true })
  assert.equal(await modes.getByRole("button", { name: "Scale with video", exact: true }).getAttribute("aria-pressed"), "true")
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.features.videoSubtitles)
  const previewSize = () => settings.locator(".subtitle-preview-scene").evaluate(scene => ({
    width: scene.getBoundingClientRect().width,
    fontSize: Number.parseFloat(getComputedStyle(scene.lastElementChild).fontSize),
  }))
  const desktopPreview = await previewSize()
  assert.ok(Math.abs(desktopPreview.fontSize - 24 * desktopPreview.width / 640) < 0.05, "settings preview uses the video window size")

  // Match X's post container, complete source and partial clone rendering track.
  // A stationary media clock isolates sizing from playback and translation timing.
  await context.route("https://x.com/**", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><title>X subtitle size fixture</title>
      <style>body{margin:0;padding:24px;font:16px system-ui;background:#faf8f5}#player,.reply-player{position:relative;width:640px;height:360px;background:#302b29}video{display:block;width:100%;height:100%}#player:fullscreen{width:100vw;height:100vh}h1{font-size:20px}.controls{box-sizing:border-box;position:absolute;bottom:0;left:0;width:100%;height:60px;background:#0006;color:white;display:flex;align-items:center;padding:12px;gap:16px}.controls button{color:white;background:transparent;border:0}</style>
      <h1>X video subtitles</h1><article><a href="https://x.com/OpenAIDevs/status/2105708732323909827"><time>Today</time></a><div id="player" data-testid="videoComponent"><video aria-label="Embedded video"></video><div class="controls" data-testid="videoControls"><button type="button">Pause</button><span>0:00 / 1:00</span></div></div></article>
      <script>const video=document.querySelector('video');const source=video.addTextTrack('subtitles','en (auto-generated)','en');source.mode='disabled';source.addCue(new VTTCue(0,60,'A new idea.'));const clone=video.addTextTrack('captions','clone','');clone.mode='showing';clone.addCue(new VTTCue(0,60,'Partial rendering clone'));window.e2eSubtitleTracks={source,clone};</script>`,
  }))
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("https://x.com/OpenAIDevs/status/2105708732323909827")
  const cdp = await context.newCDPSession(page)
  const attr = (node, name) => {
    const index = node.attributes?.indexOf(name) ?? -1
    return index < 0 ? undefined : node.attributes[index + 1]
  }
  const find = (node, predicate) => predicate(node) ? node : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(child => find(child, predicate)).find(Boolean)
  const text = node => !node ? "" : node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join("")
  const snapshot = async () => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    const host = find(root, node => attr(node, "data-readomi-subtitles") !== undefined)
    const shadow = host?.shadowRoots?.[0]
    if (!shadow)
      return {}
    const box = find(shadow, node => attr(node, "class")?.split(" ").includes("box"))
    const original = find(shadow, node => attr(node, "class") === "original")
    const translation = find(shadow, node => attr(node, "class") === "translated")
    if (!box)
      return {}
    // Fullscreen moves the closed-shadow host between document roots. Its CDP
    // node id can expire between the DOM snapshot and the style read.
    const computed = await cdp.send("CSS.getComputedStyleForNode", { nodeId: box.nodeId }).catch((error) => {
      if (error.message.includes("Could not find node with given id"))
        return null
      throw error
    })
    if (!computed)
      return {}
    const model = await cdp.send("DOM.getBoxModel", { nodeId: box.nodeId }).catch(() => null)
    const { computedStyle } = computed
    return { fontSize: Number.parseFloat(computedStyle.find(p => p.name === "font-size").value), original: text(original), translation: text(translation), bottom: model?.model.border[5], hidden: attr(box, "class")?.split(" ").includes("empty") }
  }
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 15000
    let state
    while (Date.now() < deadline) {
      state = await snapshot()
      if (predicate(state))
        return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Subtitle sizing timed out: ${JSON.stringify(state)}`)
  }
  await cdp.send("DOM.enable")
  await cdp.send("CSS.enable")
  const ready = await waitFor(state => !state.hidden && state.fontSize === 24 && state.translation?.includes("【译】"))
  assert.equal(ready.original, "A new idea.", "the complete X source wins over its showing clone")
  await page.waitForFunction(() => Object.values(window.e2eSubtitleTracks).every(track => track.mode === "hidden"))
  const videoBounds = await page.locator("#player video").boundingBox()
  const controlsBounds = await page.locator("#player .controls").boundingBox()
  const clearance = Math.min(controlsBounds.height, videoBounds.height * 0.25)
  await waitFor(state => Math.abs(state.bottom - (videoBounds.y + videoBounds.height * 0.98 - clearance)) < 0.5)
  await page.locator("#player .controls").evaluate(controls => controls.style.opacity = "0")
  await waitFor(state => Math.abs(state.bottom - (videoBounds.y + videoBounds.height * 0.98)) < 0.5)
  await page.locator("#player .controls").evaluate(controls => controls.style.opacity = "1")
  await page.evaluate(() => window.e2eSubtitleTracks.clone.mode = "showing")
  await page.waitForFunction(() => window.e2eSubtitleTracks.clone.mode === "hidden")
  const initialStyle = (await storedConfig(context)).features.subtitleStyle
  const requests = service.completions().length
  assert.equal(initialStyle.fontSizeMode, "video")
  for (const width of [320, 960, 640]) {
    await page.locator("#player").evaluate((player, width) => {
      player.style.width = `${width}px`
      player.style.height = `${width * 9 / 16}px`
    }, width)
    await waitFor(state => state.fontSize === 24 * width / 640 && state.translation === ready.translation)
  }
  await page.locator("#player").evaluate(player => player.requestFullscreen())
  const fullscreenWidth = (await page.locator("#player video").boundingBox()).width
  await waitFor(state => Math.abs(state.fontSize - 24 * fullscreenWidth / 640) < 0.05 && state.translation === ready.translation)
  await page.evaluate(() => document.exitFullscreen())
  await waitFor(state => state.fontSize === 24)
  assert.deepEqual((await storedConfig(context)).features.subtitleStyle, initialStyle, "window changes do not rewrite the saved baseline")
  await page.screenshot({ path: "/tmp/readomi-x-subtitle-responsive.png" })

  await modes.getByRole("button", { name: "Fixed size", exact: true }).click()
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.features.subtitleStyle.fontSizeMode === "fixed")
  await page.locator("#player").evaluate((player) => {
    player.style.width = "320px"
    player.style.height = "180px"
  })
  await waitFor(state => state.fontSize === 24 && state.translation === ready.translation)
  await settings.reload()
  assert.equal(await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Fixed size", exact: true }).getAttribute("aria-pressed"), "true")
  await settings.setViewportSize({ width: 390, height: 900 })
  assert.equal(await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Fixed size", exact: true }).isVisible(), true)
  assert.equal((await previewSize()).fontSize, 24, "fixed preview keeps real pixels on narrow screens")
  await settings.screenshot({ path: "/tmp/readomi-subtitle-fixed-mobile.png", fullPage: true })
  await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Scale with video", exact: true }).click()
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.features.subtitleStyle.fontSizeMode === "video")
  await waitFor(state => state.fontSize === 12 && state.translation === ready.translation)
  const mobilePreview = await previewSize()
  assert.ok(Math.abs(mobilePreview.fontSize - 24 * mobilePreview.width / 640) < 0.05, "relative preview matches narrow video windows")
  await settings.screenshot({ path: "/tmp/readomi-subtitle-video-mobile.png", fullPage: true })
  assert.equal(service.completions().length, requests, "resizing and changing sizing mode reuse the current translation")
  assert.equal(service.translationRequests().some(messages => messages.at(-1).content.includes("Partial rendering clone")), false)

  await page.evaluate(() => {
    const reply = document.createElement("article")
    reply.id = "reply"
    reply.innerHTML = "<a href=\"https://x.com/example/status/200\"><time>Reply</time></a><div class=\"reply-player\" data-testid=\"videoComponent\"><video></video><div class=\"controls\" data-testid=\"videoControls\"><button type=\"button\">Pause reply</button></div></div>"
    document.body.append(reply)
    const track = reply.querySelector("video").addTextTrack("subtitles", "English", "en")
    track.mode = "disabled"
    track.addCue(new VTTCue(0, 60, "Reply video sentence."))
    window.e2eReplyTrack = track
  })
  await page.locator("#reply button").focus()
  await waitFor(state => state.original === "Reply video sentence." && state.translation.includes("【译】Reply video sentence."))
  assert.equal(await page.locator("[data-readomi-subtitles]").count(), 1)
  assert.deepEqual(await page.evaluate(() => Object.values(window.e2eSubtitleTracks).map(track => track.mode)), ["disabled", "showing"], "switching X targets restores all previous native track modes")
  await page.locator("#reply button").evaluate(button => button.blur())
  await waitFor(state => state.original === "Reply video sentence.")
  await page.evaluate(() => {
    const old = document.querySelector("#reply video")
    const next = document.createElement("video")
    old.replaceWith(next)
    const track = next.addTextTrack("subtitles", "English", "en")
    track.mode = "disabled"
    track.addCue(new VTTCue(0, 60, "Replacement video."))
  })
  await page.locator("#reply button").focus()
  await waitFor(state => state.original === "Replacement video." && state.translation.includes("【译】Replacement video."))
  assert.equal(await page.locator("[data-readomi-subtitles]").count(), 1)
  assert.equal(await page.evaluate(() => window.e2eReplyTrack.mode), "disabled", "replacing the X video releases the old native track")
})
