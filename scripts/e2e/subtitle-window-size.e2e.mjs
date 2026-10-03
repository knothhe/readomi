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
  assert.ok(Math.abs(desktopPreview.fontSize - 20 * desktopPreview.width / 640) < 0.05, "settings preview uses the video window size")

  // Match X's post container, complete source and partial clone rendering track.
  // A stationary media clock isolates sizing from playback and translation timing.
  await context.route("https://x.com/**", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><title>X subtitle size fixture</title>
      <style>body{margin:0;padding:24px;font:16px system-ui;background:#faf8f5}#player,.reply-player{position:relative;width:640px;height:360px;background:#302b29}video{display:block;width:100%;height:100%}#player:fullscreen{width:100vw;height:100vh}h1{font-size:20px}.controls{box-sizing:border-box;position:absolute;bottom:0;left:0;width:100%;height:60px;background:#0006;color:white;display:flex;align-items:center;padding:12px;gap:16px}.controls>span{margin-right:auto}.controls button{color:white;background:transparent;border:0}</style>
      <h1>X video subtitles</h1><article><a href="https://x.com/OpenAIDevs/status/2105708732323909827"><time>Today</time></a><div id="player" data-testid="videoComponent"><video aria-label="Embedded video"></video><div class="controls" data-testid="videoControls"><button type="button" aria-label="Pause">Ⅱ</button><span>0:00 / 1:00</span><button type="button" aria-label="Fullscreen" onclick="document.querySelector('#player').requestFullscreen()">⛶</button></div></div></article>
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
  const rectangle = quad => quad && { left: quad[0], top: quad[1], right: quad[2], bottom: quad[5] }
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
    const quad = model?.model.border
    const controlsHost = find(root, node => attr(node, "data-readomi-video-controls") !== undefined)
    const controlsShadow = controlsHost?.shadowRoots?.[0]
    const dock = controlsShadow && attr(controlsHost, "data-hidden") === undefined && attr(controlsHost, "data-idle") === undefined && attr(controlsHost, "data-inline-anchor") === undefined ? find(controlsShadow, node => attr(node, "class") === "dock") : undefined
    const dockModel = dock ? await cdp.send("DOM.getBoxModel", { nodeId: dock.nodeId }).catch(() => null) : null
    const controlsHidden = !controlsHost || attr(controlsHost, "data-hidden") !== undefined || attr(controlsHost, "data-idle") !== undefined
    const menuOpen = controlsShadow && !controlsHidden && find(controlsShadow, node => attr(node, "aria-expanded") === "true")
    const menuPanel = menuOpen && find(controlsShadow, node => attr(node, "class") === "panel")
    const menuDock = menuOpen && find(controlsShadow, node => attr(node, "class") === "dock")
    const [panelModel, menuDockModel] = await Promise.all([
      menuPanel ? cdp.send("DOM.getBoxModel", { nodeId: menuPanel.nodeId }).catch(() => null) : null,
      menuDock ? cdp.send("DOM.getBoxModel", { nodeId: menuDock.nodeId }).catch(() => null) : null,
    ])
    return { controlsHidden, controlsInert: controlsHost && attr(controlsHost, "inert") !== undefined, dockTop: dockModel?.model.border[1], menuPanel: rectangle(panelModel?.model.border), menuDock: rectangle(menuDockModel?.model.border), fontSize: Number.parseFloat(computedStyle.find(p => p.name === "font-size").value), original: text(original), translation: text(translation), bottom: quad?.[5], bounds: rectangle(quad), hidden: attr(box, "class")?.split(" ").includes("empty") }
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
  const waitForInlineToolbar = async () => {
    try {
      await page.waitForFunction(() => {
        const toolbar = document.querySelector("#player .controls")
        const host = toolbar?.querySelector("[data-readomi-video-controls]")
        const fullscreen = toolbar?.querySelector("button[aria-label='Fullscreen']")
        const play = toolbar?.querySelector("button[aria-label='Pause']")
        const time = toolbar?.querySelector("span")
        if (!host || !fullscreen || !play || !time || host.dataset.placement !== "inline" || host.dataset.toolbar !== "x")
          return false
        const row = toolbar.getBoundingClientRect()
        const dock = host.getBoundingClientRect()
        const button = fullscreen.getBoundingClientRect()
        return toolbar.firstElementChild === play && host.previousElementSibling === time && host.nextElementSibling === fullscreen && dock.width > 0
          && dock.left >= time.getBoundingClientRect().right - 0.5 && dock.right <= button.left + 0.5 && button.right <= row.right + 0.5
          && Math.abs(button.left - dock.right - 24) < 1
          && dock.top >= row.top && dock.bottom <= row.bottom + 0.5
          && Math.abs((dock.top + dock.bottom) / 2 - (button.top + button.bottom) / 2) < 1
      }, undefined, { timeout: 15_000 })
    }
    catch (error) {
      console.info("X toolbar geometry:", await page.locator("#player .controls").evaluate(toolbar => ({
        bounds: toolbar.getBoundingClientRect().toJSON(),
        children: [...toolbar.children].map(child => ({
          tag: child.tagName,
          bounds: child.getBoundingClientRect().toJSON(),
          marginLeft: getComputedStyle(child).marginLeft,
          marginRight: getComputedStyle(child).marginRight,
          placement: child.getAttribute("data-placement"),
        })),
        controls: [...document.querySelectorAll("[data-readomi-video-controls]")].map(host => ({
          placement: host.getAttribute("data-placement"),
          bounds: host.getBoundingClientRect().toJSON(),
        })),
      })))
      throw error
    }
    assert.equal(await page.locator("#player .controls").evaluate((toolbar) => {
      const host = toolbar.querySelector("[data-readomi-video-controls]")
      return toolbar.firstElementChild === toolbar.querySelector("button[aria-label='Pause']") && host?.previousElementSibling === toolbar.querySelector("span") && host?.nextElementSibling === toolbar.querySelector("button[aria-label='Fullscreen']")
    }), true, "Readomi joins the native X right tools after playback and time, before fullscreen")
  }
  const ready = await waitFor(state => !state.hidden && state.fontSize === 20 && state.translation?.includes("【译】"))
  assert.equal(ready.original, "A new idea.", "the complete X source wins over its showing clone")
  await waitForInlineToolbar()
  await page.waitForFunction(() => Object.values(window.e2eSubtitleTracks).every(track => track.mode === "hidden"))
  const videoBounds = await page.locator("#player video").boundingBox()
  const controlsBounds = await page.locator("#player .controls").boundingBox()
  const clearance = Math.min(controlsBounds.height, videoBounds.height * 0.25)
  await waitFor(state => Math.abs(state.bottom - Math.min(videoBounds.y + videoBounds.height * 0.98 - clearance, state.dockTop === undefined ? Infinity : state.dockTop - 8)) < 0.5)
  await page.locator("#player .controls").evaluate(controls => controls.style.opacity = "0")
  await waitFor(state => state.controlsHidden && state.controlsInert && Math.abs(state.bottom - Math.min(videoBounds.y + videoBounds.height * 0.98, state.dockTop === undefined ? Infinity : state.dockTop - 8)) < 0.5)
  assert.equal(await page.locator("#player .controls [data-readomi-video-controls]").count(), 1, "X opacity auto-hide retains the native toolbar slot")
  await page.locator("#player .controls").evaluate(controls => controls.style.opacity = "1")
  await waitFor(state => !state.controlsHidden && !state.controlsInert)
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
    await waitFor(state => state.fontSize === 20 * width / 640 && state.translation === ready.translation)
    await waitForInlineToolbar()
  }
  await page.locator("#player").getByRole("button", { name: "Fullscreen", exact: true }).click()
  const fullscreenWidth = (await page.locator("#player video").boundingBox()).width
  await waitFor(state => Math.abs(state.fontSize - 20 * fullscreenWidth / 640) < 0.05 && state.translation === ready.translation)
  await page.evaluate(() => document.exitFullscreen())
  await waitFor(state => state.fontSize === 20)
  assert.deepEqual((await storedConfig(context)).features.subtitleStyle, initialStyle, "window changes do not rewrite the saved baseline")
  await page.screenshot({ path: "/tmp/readomi-x-subtitle-responsive.png" })

  await modes.getByRole("button", { name: "Fixed size", exact: true }).click()
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.features.subtitleStyle.fontSizeMode === "fixed")
  await page.locator("#player").evaluate((player) => {
    player.style.width = "320px"
    player.style.height = "180px"
  })
  await waitFor(state => state.fontSize === 20 && state.translation === ready.translation)
  await settings.reload()
  assert.equal(await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Fixed size", exact: true }).getAttribute("aria-pressed"), "true")
  await settings.setViewportSize({ width: 390, height: 900 })
  assert.equal(await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Fixed size", exact: true }).isVisible(), true)
  assert.equal((await previewSize()).fontSize, 20, "fixed preview keeps real pixels on narrow screens")
  await settings.screenshot({ path: "/tmp/readomi-subtitle-fixed-mobile.png", fullPage: true })
  await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Scale with video", exact: true }).click()
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.features.subtitleStyle.fontSizeMode === "video")
  await waitFor(state => state.fontSize === 10 && state.translation === ready.translation)
  const mobilePreview = await previewSize()
  assert.ok(Math.abs(mobilePreview.fontSize - 20 * mobilePreview.width / 640) < 0.05, "relative preview matches narrow video windows")
  await settings.screenshot({ path: "/tmp/readomi-subtitle-video-mobile.png", fullPage: true })
  assert.equal(service.completions().length, requests, "resizing and changing sizing mode reuse the current translation")
  assert.equal(service.translationRequests().some(messages => messages.at(-1).content.includes("Partial rendering clone")), false)

  const waitForStyle = async (preset, fontSize, fontSizeMode) => {
    const deadline = Date.now() + 15000
    let style
    while (Date.now() < deadline) {
      style = (await storedConfig(context)).features.subtitleStyle
      if (style.preset === preset && style.fontSize === fontSize && style.fontSizeMode === fontSizeMode)
        return style
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Subtitle preset was not saved: ${JSON.stringify(style)}`)
  }
  const presets = settings.getByRole("group", { name: "Subtitle preset", exact: true })
  await presets.getByRole("button", { name: "Prominent", exact: true }).click()
  await waitForStyle("study", 24, "video")
  await waitFor(state => state.fontSize === 12 && state.translation === ready.translation)
  await modes.getByRole("button", { name: "Fixed size", exact: true }).click()
  await waitForStyle("study", 24, "fixed")
  await presets.getByRole("button", { name: "Prominent", exact: true }).click()
  await waitForStyle("study", 24, "fixed")
  await waitFor(state => state.fontSize === 24 && state.translation === ready.translation)
  await settings.screenshot({ path: "/tmp/readomi-subtitle-preset-fixed-study.png", fullPage: true })

  // The dock and preset panel use a closed shadow root. CDP reads the
  // button's bounds, then a real pointer click exercises its product handler.
  const clickPlayerControl = async (predicate) => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    const host = find(root, node => attr(node, "data-readomi-video-controls") !== undefined)
    const button = find(host.shadowRoots[0], predicate)
    assert.ok(button, "the requested player control exists")
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId: button.nodeId })
    const quad = model.border
    await page.mouse.click((quad[0] + quad[2]) / 2, (quad[1] + quad[5]) / 2)
  }
  const selectPlayerPreset = async (preset) => {
    await clickPlayerControl(node => attr(node, "aria-label") === "Adjust subtitle preset")
    const video = await page.locator("#player video").boundingBox()
    await waitFor((state) => {
      const panel = state.menuPanel
      const dock = state.menuDock
      if (!panel || !dock)
        return false
      const expectedRight = Math.max(video.x + 12 + panel.right - panel.left, Math.min(dock.right, video.x + video.width - 12))
      return Math.abs(panel.right - expectedRight) < 2 && panel.bottom <= dock.top + 1
        && panel.left >= video.x && panel.right <= video.x + video.width
        && panel.top >= video.y && panel.bottom <= video.y + video.height
    })
    await page.locator("#player .controls").evaluate(controls => controls.style.opacity = "0")
    await waitFor(state => state.controlsHidden && state.controlsInert && !state.menuPanel && !state.menuDock)
    assert.equal(await page.locator("#player .controls [data-readomi-controls-anchor]").count(), 1, "the hidden preset menu remains anchored in X's native toolbar")
    await page.locator("#player .controls").evaluate(controls => controls.style.opacity = "1")
    await waitFor(state => !state.controlsHidden && state.menuPanel && state.menuDock)
    await clickPlayerControl(node => attr(node, "data-preset") === preset)
    await clickPlayerControl(node => attr(node, "aria-label") === "Adjust subtitle preset")
    await waitForInlineToolbar()
  }
  await selectPlayerPreset("compact")
  await waitForStyle("compact", 20, "fixed")
  await waitFor(state => state.fontSize === 20 && state.translation === ready.translation)
  await modes.getByRole("button", { name: "Scale with video", exact: true }).click()
  await waitForStyle("compact", 20, "video")
  await selectPlayerPreset("study")
  await waitForStyle("study", 24, "video")
  await waitFor(state => state.fontSize === 12 && state.translation === ready.translation)
  assert.deepEqual((await storedConfig(context)).features.subtitleStyle.position, initialStyle.position, "both preset controls preserve the saved position")
  assert.equal(service.completions().length, requests, "both preset controls reuse the current translation")
  await page.screenshot({ path: "/tmp/readomi-subtitle-preset-video-study.png" })

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
  // Menu clicks leave the pointer over the main video. Isolate the focus
  // target from that hover target when exercising the existing X selection.
  await page.mouse.move(0, 0)
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
