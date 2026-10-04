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

it("X HTML5 subtitles support live relative sizing, fixed sizing and adjustable backgrounds without losing translations", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await configureService(settings, launched.extensionId, setupDocumentFor(service.origin))
  await settings.getByRole("link", { name: "Video subtitles", exact: true }).click()
  await settings.getByRole("switch", { name: "Video subtitle translation", exact: true }).click()
  const customOptions = settings.locator(".subtitle-custom > summary")
  assert.equal(await customOptions.evaluate(summary => summary.closest("details").open), false, "custom subtitle controls start collapsed")
  const modes = settings.getByRole("group", { name: "Size mode", exact: true })
  assert.equal(await modes.getByRole("button", { name: "Scale with video", exact: true }).getAttribute("aria-pressed"), "true")
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.features.videoSubtitles)
  const previewSize = () => settings.locator(".subtitle-preview-scene").evaluate(scene => ({
    width: scene.getBoundingClientRect().width,
    fontSize: Number.parseFloat(getComputedStyle(scene.lastElementChild).fontSize),
    backgroundColor: getComputedStyle(scene.lastElementChild).backgroundColor,
  }))
  const colorOpacity = (color) => {
    const components = color?.match(/[\d.]+/g)?.map(Number) ?? []
    return components.length === 4 ? components[3] : color === "transparent" ? 0 : 1
  }
  const waitForPreview = async (style) => {
    await settings.waitForFunction(({ mode, size, opacity }) => {
      const scene = document.querySelector(".subtitle-preview-scene")
      if (!scene?.lastElementChild)
        return false
      const computed = getComputedStyle(scene.lastElementChild)
      const components = computed.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? []
      const actualOpacity = components.length === 4 ? components[3] : computed.backgroundColor === "transparent" ? 0 : 1
      const expectedSize = mode === "video" ? scene.getBoundingClientRect().width * size / 100 : size
      return Math.abs(Number.parseFloat(computed.fontSize) - expectedSize) < 0.05 && Math.abs(actualOpacity - opacity) < 0.01
    }, {
      mode: style.fontSizeMode,
      size: style.fontSizeMode === "video" ? style.relativeFontSize : style.fontSize,
      opacity: style.backgroundEnabled ? style.backgroundOpacity / 100 : 0,
    })
  }
  const desktopPreview = await previewSize()
  assert.ok(Math.abs(desktopPreview.fontSize - desktopPreview.width * 3 / 100) < 0.05, "settings preview uses a percentage of the video window width")
  assert.equal(colorOpacity(desktopPreview.backgroundColor), 0, "the default Transparent preset has no background")

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
    const menuReset = menuOpen && find(controlsShadow, node => attr(node, "class") === "reset")
    const [panelModel, menuDockModel, resetModel] = await Promise.all([
      menuPanel ? cdp.send("DOM.getBoxModel", { nodeId: menuPanel.nodeId }).catch(() => null) : null,
      menuDock ? cdp.send("DOM.getBoxModel", { nodeId: menuDock.nodeId }).catch(() => null) : null,
      menuReset ? cdp.send("DOM.getBoxModel", { nodeId: menuReset.nodeId }).catch(() => null) : null,
    ])
    return { controlsHidden, controlsInert: controlsHost && attr(controlsHost, "inert") !== undefined, dockTop: dockModel?.model.border[1], menuPanel: rectangle(panelModel?.model.border), menuDock: rectangle(menuDockModel?.model.border), menuReset: rectangle(resetModel?.model.border), fontSize: Number.parseFloat(computedStyle.find(p => p.name === "font-size").value), backgroundColor: computedStyle.find(p => p.name === "background-color").value, original: text(original), translation: text(translation), bottom: quad?.[5], bounds: rectangle(quad), hidden: attr(box, "class")?.split(" ").includes("empty") }
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
  const presetStyles = [
    { preset: "clear", label: "Transparent", fontSize: 20, relativeFontSize: 3, backgroundEnabled: false, backgroundOpacity: 0 },
    { preset: "compact", label: "Compact", fontSize: 16, relativeFontSize: 2.5, backgroundEnabled: true, backgroundOpacity: 35 },
    { preset: "study", label: "Focus", fontSize: 24, relativeFontSize: 3.75, backgroundEnabled: true, backgroundOpacity: 65 },
    { preset: "cinema", label: "Cinema", fontSize: 28, relativeFontSize: 4.5, backgroundEnabled: true, backgroundOpacity: 85 },
  ]
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
  const presetLayout = async () => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    const host = find(root, node => attr(node, "data-readomi-video-controls") !== undefined)
    return Promise.all(presetStyles.map(async ({ preset, label }) => {
      const button = find(host.shadowRoots[0], node => attr(node, "data-preset") === preset)
      assert.ok(button, `the ${label} player preset exists`)
      const { object } = await cdp.send("DOM.resolveNode", { nodeId: button.nodeId })
      try {
        const { result } = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: `function() {
            const range = this.ownerDocument.createRange();
            range.selectNodeContents(this);
            return {
              text: this.textContent,
              bounds: this.getBoundingClientRect().toJSON(),
              scrollWidth: this.scrollWidth,
              clientWidth: this.clientWidth,
              textRects: [...range.getClientRects()].map(rect => rect.toJSON())
            };
          }`,
          returnByValue: true,
        })
        assert.equal(result.value.text, label, `the ${label} player preset keeps its complete label`)
        return result.value
      }
      finally {
        await cdp.send("Runtime.releaseObject", { objectId: object.objectId })
      }
    }))
  }
  const assertPresetLayout = async (panel) => {
    const buttons = await presetLayout()
    for (const { text, bounds, scrollWidth, clientWidth, textRects } of buttons) {
      assert.ok(scrollWidth <= clientWidth, `${text} does not overflow its button horizontally`)
      assert.ok(textRects.length > 0, `${text} is rendered`)
      assert.ok(bounds.left >= panel.left && bounds.right <= panel.right && bounds.top >= panel.top && bounds.bottom <= panel.bottom + 0.5, `${text} stays visible inside the player menu`)
      for (const rect of textRects) {
        assert.ok(rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5 && rect.top >= bounds.top - 0.5 && rect.bottom <= bounds.bottom + 0.5, `${text} stays fully inside its button`)
      }
    }
    const [clear, compact, study, cinema] = buttons.map(button => button.bounds)
    assert.ok(Math.abs(clear.top - compact.top) < 0.5 && Math.abs(study.top - cinema.top) < 0.5, "the four presets form two rows")
    assert.ok(Math.abs(clear.left - study.left) < 0.5 && Math.abs(compact.left - cinema.left) < 0.5, "the four presets form two columns")
    assert.ok(clear.right <= compact.left && study.right <= cinema.left && clear.bottom <= study.top && compact.bottom <= cinema.top, "preset buttons do not overlap")
  }
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
  const ready = await waitFor(state => !state.hidden && Math.abs(state.fontSize - 19.2) < 0.05 && colorOpacity(state.backgroundColor) === 0 && state.translation?.includes("【译】"))
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
  assert.equal(initialStyle.fontSize, 20)
  assert.equal(initialStyle.relativeFontSize, 3)
  assert.equal(initialStyle.backgroundEnabled, false)
  assert.equal(initialStyle.backgroundOpacity, 0)
  for (const width of [320, 960, 640]) {
    await page.locator("#player").evaluate((player, width) => {
      player.style.width = `${width}px`
      player.style.height = `${width * 9 / 16}px`
    }, width)
    await waitFor(state => Math.abs(state.fontSize - width * 3 / 100) < 0.05 && state.translation === ready.translation)
    await waitForInlineToolbar()
    if (width === 320 || width === 640) {
      await clickPlayerControl(node => attr(node, "aria-label") === "Adjust subtitle preset")
      const opened = await waitFor(state => state.menuPanel && state.menuDock)
      await assertPresetLayout(opened.menuPanel)
      await page.screenshot({ path: width === 640 ? "/tmp/readomi-subtitle-player-menu.png" : "/tmp/readomi-subtitle-player-menu-mobile.png" })
      if (width === 320) {
        await page.mouse.move((opened.menuPanel.left + opened.menuPanel.right) / 2, (opened.menuPanel.top + opened.menuPanel.bottom) / 2)
        await page.mouse.wheel(0, 180)
        await waitFor(state => state.menuReset && state.menuReset.top >= state.menuPanel.top && state.menuReset.bottom <= state.menuPanel.bottom + 0.5)
        assert.deepEqual((await storedConfig(context)).features.subtitleStyle, initialStyle, "scrolling to the narrow menu's last action preserves subtitle settings")
      }
      await clickPlayerControl(node => attr(node, "aria-label") === "Adjust subtitle preset")
      await waitForInlineToolbar()
    }
  }
  await page.locator("#player").getByRole("button", { name: "Fullscreen", exact: true }).click()
  const fullscreenWidth = (await page.locator("#player video").boundingBox()).width
  await waitFor(state => Math.abs(state.fontSize - fullscreenWidth * 3 / 100) < 0.05 && state.translation === ready.translation)
  await page.evaluate(() => document.exitFullscreen())
  await waitFor(state => Math.abs(state.fontSize - 19.2) < 0.05)
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
  assert.equal(await customOptions.evaluate(summary => summary.closest("details").open), false, "reloading settings restores the compact presentation")
  assert.equal(await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Fixed size", exact: true }).getAttribute("aria-pressed"), "true")
  await settings.setViewportSize({ width: 390, height: 900 })
  assert.equal(await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Fixed size", exact: true }).isVisible(), true)
  assert.equal((await previewSize()).fontSize, 20, "fixed preview keeps real pixels on narrow screens")
  await settings.screenshot({ path: "/tmp/readomi-subtitle-fixed-mobile.png", fullPage: true })
  await settings.getByRole("group", { name: "Size mode", exact: true }).getByRole("button", { name: "Scale with video", exact: true }).click()
  await settings.waitForFunction(async () => (await chrome.storage.local.get("config")).config.features.subtitleStyle.fontSizeMode === "video")
  await waitFor(state => Math.abs(state.fontSize - 9.6) < 0.05 && state.translation === ready.translation)
  const mobilePreview = await previewSize()
  assert.ok(Math.abs(mobilePreview.fontSize - mobilePreview.width * 3 / 100) < 0.05, "relative preview matches narrow video windows")
  await settings.screenshot({ path: "/tmp/readomi-subtitle-video-mobile.png", fullPage: true })
  assert.equal(service.completions().length, requests, "resizing and changing sizing mode reuse the current translation")
  assert.equal(service.translationRequests().some(messages => messages.at(-1).content.includes("Partial rendering clone")), false)

  const waitForStyle = async (expected) => {
    const deadline = Date.now() + 15000
    let style
    while (Date.now() < deadline) {
      style = (await storedConfig(context)).features.subtitleStyle
      if (Object.entries(expected).every(([key, value]) => JSON.stringify(style[key]) === JSON.stringify(value)))
        return style
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Subtitle style was not saved: expected ${JSON.stringify(expected)}, received ${JSON.stringify(style)}`)
  }

  await customOptions.click()
  // Exercise native range keyboard interaction and precise numeric entry.
  // Each mode owns its saved size, so switching never rewrites the other value.
  const sizeSlider = settings.getByRole("slider", { name: "Subtitle size", exact: true })
  const sizeInput = settings.getByRole("spinbutton", { name: "Subtitle size", exact: true })
  assert.equal(await sizeSlider.getAttribute("min"), "1.25")
  assert.equal(await sizeSlider.getAttribute("max"), "12.5")
  assert.equal(await sizeSlider.getAttribute("step"), "0.25")
  assert.match(await sizeSlider.getAttribute("aria-valuetext"), /%/)
  await sizeSlider.press("ArrowRight")
  await waitForStyle({ relativeFontSize: 3.25, fontSize: 20 })
  await waitFor(state => Math.abs(state.fontSize - 10.4) < 0.05 && state.translation === ready.translation)
  await sizeInput.fill("4.25")
  await sizeInput.press("Enter")
  await waitForPreview(await waitForStyle({ relativeFontSize: 4.25, fontSize: 20 }))
  await waitFor(state => Math.abs(state.fontSize - 13.6) < 0.05 && state.translation === ready.translation)
  await modes.getByRole("button", { name: "Fixed size", exact: true }).click()
  await waitForStyle({ fontSizeMode: "fixed", relativeFontSize: 4.25, fontSize: 20 })
  assert.equal(await sizeSlider.getAttribute("min"), "8")
  assert.equal(await sizeSlider.getAttribute("max"), "80")
  assert.equal(await sizeSlider.getAttribute("step"), "1")
  assert.match(await sizeSlider.getAttribute("aria-valuetext"), /px/)
  await sizeSlider.press("Home")
  await waitForPreview(await waitForStyle({ fontSize: 8, relativeFontSize: 4.25 }))
  await waitFor(state => state.fontSize === 8 && state.translation === ready.translation)
  await sizeInput.fill("18")
  await sizeInput.press("Tab")
  await waitForStyle({ fontSize: 18, relativeFontSize: 4.25 })
  await waitFor(state => state.fontSize === 18 && state.translation === ready.translation)
  await modes.getByRole("button", { name: "Scale with video", exact: true }).click()
  await waitForPreview(await waitForStyle({ fontSizeMode: "video", relativeFontSize: 4.25, fontSize: 18 }))
  assert.equal(await sizeInput.inputValue(), "4.25", "relative numeric input restores its own saved value")
  await modes.getByRole("button", { name: "Fixed size", exact: true }).click()
  await waitForStyle({ fontSizeMode: "fixed", relativeFontSize: 4.25, fontSize: 18 })
  assert.equal(await sizeInput.inputValue(), "18", "fixed numeric input restores its own saved value")
  await modes.getByRole("button", { name: "Scale with video", exact: true }).click()
  await waitForStyle({ fontSizeMode: "video", relativeFontSize: 4.25, fontSize: 18 })

  const depthSlider = settings.getByRole("slider", { name: "Background depth", exact: true })
  const depthInput = settings.getByRole("spinbutton", { name: "Background depth", exact: true })
  assert.equal(await settings.getByRole("switch", { name: "Subtitle background", exact: true }).count(), 0, "depth replaces the separate background switch")
  assert.equal(await depthSlider.isVisible(), true, "zero depth retains the same custom controls")
  assert.equal(await depthInput.inputValue(), "0")
  assert.equal(await depthSlider.getAttribute("step"), "1")
  const previewPadding = await settings.locator(".subtitle-preview-caption").evaluate(caption => getComputedStyle(caption).padding)
  const panelHeight = (await settings.locator(".subtitle-settings-group").boundingBox()).height
  await depthSlider.press("ArrowRight")
  await waitForStyle({ backgroundEnabled: true, backgroundOpacity: 1 })
  await depthInput.fill("72")
  await depthInput.press("Enter")
  await waitForPreview(await waitForStyle({ backgroundEnabled: true, backgroundOpacity: 72 }))
  await waitFor(state => Math.abs(colorOpacity(state.backgroundColor) - 0.72) < 0.01 && state.translation === ready.translation)
  await depthSlider.press("Home")
  await waitForPreview(await waitForStyle({ backgroundEnabled: false, backgroundOpacity: 0 }))
  assert.equal(await depthSlider.isVisible(), true, "no-background depth keeps the slider visible")
  assert.equal(await depthInput.isVisible(), true)
  assert.equal(await settings.locator(".subtitle-preview-caption").evaluate(caption => getComputedStyle(caption).padding), previewPadding, "background fill keeps preview padding fixed")
  assert.ok(Math.abs((await settings.locator(".subtitle-settings-group").boundingBox()).height - panelHeight) < 1, "background depth does not insert or remove settings rows")
  await waitFor(state => colorOpacity(state.backgroundColor) === 0 && state.translation === ready.translation)
  await depthInput.fill("72")
  await depthInput.press("Enter")
  await waitForPreview(await waitForStyle({ backgroundEnabled: true, backgroundOpacity: 72 }))
  await waitFor(state => Math.abs(colorOpacity(state.backgroundColor) - 0.72) < 0.01 && state.translation === ready.translation)
  await settings.reload()
  assert.equal(await customOptions.evaluate(summary => summary.closest("details").open), false, "reload returns to the compact main list")
  await customOptions.click()
  assert.equal(await sizeInput.inputValue(), "4.25")
  assert.equal(await depthInput.inputValue(), "72", "reloading restores saved background depth")
  assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "narrow controls fit without horizontal overflow")
  await settings.setViewportSize({ width: 1280, height: 900 })
  await waitForPreview(await storedConfig(context).then(config => config.features.subtitleStyle))
  await settings.screenshot({ path: "/tmp/readomi-subtitle-settings-desktop.png", fullPage: true })

  const position = { x: 50, y: 55 }
  await settings.getByRole("group", { name: "Subtitle position", exact: true }).getByRole("button", { name: "Center", exact: true }).click()
  await waitForStyle({ position })
  const presets = settings.getByRole("group", { name: "Subtitle preset", exact: true })
  for (const { label, ...presetStyle } of presetStyles) {
    await presets.getByRole("button", { name: label, exact: true }).click()
    await waitForPreview(await waitForStyle({ ...presetStyle, fontSizeMode: "video", position }))
    await waitFor(state => Math.abs(state.fontSize - 320 * presetStyle.relativeFontSize / 100) < 0.05
      && Math.abs(colorOpacity(state.backgroundColor) - (presetStyle.backgroundEnabled ? presetStyle.backgroundOpacity / 100 : 0)) < 0.01
      && state.translation === ready.translation)
  }
  await modes.getByRole("button", { name: "Fixed size", exact: true }).click()
  await waitForStyle({ preset: "cinema", fontSize: 28, relativeFontSize: 4.5, fontSizeMode: "fixed", position })
  await waitFor(state => state.fontSize === 28 && state.translation === ready.translation)
  await settings.screenshot({ path: "/tmp/readomi-subtitle-preset-fixed-cinema.png", fullPage: true })

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
  for (const { label: _label, ...presetStyle } of presetStyles) {
    await selectPlayerPreset(presetStyle.preset)
    await waitForPreview(await waitForStyle({ ...presetStyle, fontSizeMode: "fixed", position }))
    await waitFor(state => state.fontSize === presetStyle.fontSize
      && Math.abs(colorOpacity(state.backgroundColor) - (presetStyle.backgroundEnabled ? presetStyle.backgroundOpacity / 100 : 0)) < 0.01
      && state.translation === ready.translation)
  }
  await modes.getByRole("button", { name: "Scale with video", exact: true }).click()
  await waitForStyle({ preset: "cinema", relativeFontSize: 4.5, fontSizeMode: "video", position })
  await selectPlayerPreset("study")
  await waitForStyle({ preset: "study", fontSize: 24, relativeFontSize: 3.75, fontSizeMode: "video", backgroundEnabled: true, backgroundOpacity: 65, position })
  await waitFor(state => state.fontSize === 12 && Math.abs(colorOpacity(state.backgroundColor) - 0.65) < 0.01 && state.translation === ready.translation)
  assert.deepEqual((await storedConfig(context)).features.subtitleStyle.position, position, "all four presets preserve a manually selected position in both controls")
  assert.equal(service.completions().length, requests, "manual size, background and preset changes reuse the current translation")
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
