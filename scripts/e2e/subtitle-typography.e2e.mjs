/* global chrome -- callbacks run inside the extension page or service worker. */
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure, storedConfig, waitForStoredConfig } from "./browser.mjs"
import { LANGUAGE_RULES_FIXTURES, setupDocumentFor, startFakeService } from "./fake-service.mjs"

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

it("subtitle presets and editable translation typography stay synchronized across settings, playback and reload", async () => {
  service = await startFakeService({ languageRules: true })
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await configureService(settings, launched.extensionId, setupDocumentFor(service.origin))
  await settings.getByRole("link", { name: "Video subtitles", exact: true }).click()
  await settings.getByRole("switch", { name: "Enable video subtitle translation by default", exact: true }).click()
  await waitForStoredConfig(context, config => config.features.videoSubtitles)
  const output = "/tmp/readomi-subtitle-implemented"
  await mkdir(output, { recursive: true })
  const example = LANGUAGE_RULES_FIXTURES.design
  await context.route("https://x.com/**", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><title>Readomi subtitle typography</title>
      <style>body{margin:0;padding:40px;background:#faf8f5;font:14px system-ui;color:#302b29}h1{font-size:21px;font-weight:500;margin:0 0 22px}#player{width:960px;height:540px;position:relative;border-radius:12px;overflow:hidden;background:radial-gradient(circle at 72% 24%,#d3ccb1 0 4%,transparent 4.2%),linear-gradient(166deg,transparent 48%,#6c8e87 48% 56%,transparent 56%),linear-gradient(16deg,transparent 42%,#335f58 42% 52%,transparent 52%),linear-gradient(#25434a,#56766f 58%,#42665e 58%,#243f3f)}video{width:100%;height:100%;display:block}.controls{position:absolute;bottom:0;left:0;width:100%;height:42px;background:#0003;display:flex;gap:14px;align-items:center;padding:0 16px;box-sizing:border-box;color:#fff}.controls span{margin-right:auto}.controls button{color:#fff;background:transparent;border:0;font-size:14px}p{color:#847b73;font-size:12px}</style>
      <h1>Readomi · 实际播放器字幕效果</h1><article><a href="https://x.com/readomi/status/100"><time></time></a><div id="player" data-testid="videoComponent"><video></video><div class="controls" data-testid="videoControls"><button>Ⅱ</button><span>0:12 / 1:00</span><button>⛶</button></div></div></article><p>同一句双语字幕；使用构建后的扩展渲染。</p>
      <script>const video=document.querySelector('video');const track=video.addTextTrack('subtitles','English','en');track.mode='disabled';track.addCue(new VTTCue(0,60,${JSON.stringify(example.en)}));</script>`,
  }))
  const player = await context.newPage()
  await player.setViewportSize({ width: 1040, height: 710 })
  await player.goto("https://x.com/readomi/status/100")
  const cdp = await context.newCDPSession(player)
  await cdp.send("DOM.enable")
  await cdp.send("CSS.enable")
  const attr = (node, name) => {
    const index = node.attributes?.indexOf(name) ?? -1
    return index < 0 ? undefined : node.attributes[index + 1]
  }
  const find = (node, predicate) => !node ? undefined : predicate(node) ? node : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(child => find(child, predicate)).find(Boolean)
  const snapshot = async () => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    const host = find(root, node => attr(node, "data-readomi-subtitles") !== undefined)
    if (!host)
      return {}
    const shadow = host.shadowRoots[0]
    const text = node => node ? node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join("") : ""
    const original = find(shadow, node => attr(node, "class") === "original")
    const translation = find(shadow, node => attr(node, "class") === "translated")
    const box = find(shadow, node => attr(node, "class")?.split(" ").includes("box"))
    const style = async (node) => {
      const result = await cdp.send("CSS.getComputedStyleForNode", { nodeId: node.nodeId })
      return Object.fromEntries(result.computedStyle.map(item => [item.name, item.value]))
    }
    return { original: text(original), translation: text(translation), originalStyle: await style(original), translationStyle: await style(translation), boxStyle: await style(box) }
  }
  const waitForTypography = async (predicate) => {
    const deadline = Date.now() + 15000
    let state
    while (Date.now() < deadline) {
      state = await snapshot()
      if (predicate(state))
        return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Subtitle typography timed out: ${JSON.stringify(state)}`)
  }
  await waitForTypography(state => state.translation === example.zh)
  const presets = settings.getByRole("group", { name: "Subtitle preset", exact: true })
  const variants = [
    { preset: "clear", label: "Pure white", color: "rgb(255, 255, 255)", font: "sans", ratio: 1, size: 3.5 },
    { preset: "gold", label: "Warm gold", color: "rgb(255, 224, 160)", font: "serif", ratio: 1, size: 3.5 },
    { preset: "ink", label: "Ink card", color: "rgb(249, 250, 251)", font: "sans", ratio: 1, size: 3.5 },
  ]
  for (const variant of variants) {
    await presets.getByRole("button", { name: variant.label, exact: true }).click()
    await waitForStoredConfig(context, config => config.features.subtitleStyle.preset === variant.preset)
    await settings.locator(".subtitle-custom > summary").click()
    assert.equal(await settings.getByRole("spinbutton", { name: "Subtitle size", exact: true }).inputValue(), "100")
    assert.equal(await settings.getByRole("slider", { name: "Original text size", exact: true }).inputValue(), "100")
    await settings.locator(".subtitle-custom > summary").click()
    const state = await waitForTypography(state => state.translationStyle?.color === variant.color && state.boxStyle?.["font-size"] === `${540 * variant.size / 100}px`)
    assert.equal(state.translation, example.zh)
    assert.ok(state.translationStyle["font-family"].includes(variant.font === "serif" ? "Songti SC" : "system-ui"))
    assert.ok(Math.abs(Number.parseFloat(state.originalStyle["font-size"]) / Number.parseFloat(state.translationStyle["font-size"]) - variant.ratio) < 0.001)
    assert.equal(state.boxStyle["text-align"], variant.preset === "ink" ? "left" : "center")
    if (variant.preset === "ink")
      assert.equal(state.boxStyle["background-color"], "rgba(16, 25, 27, 0.78)")
    else
      assert.ok(Number.parseFloat(state.boxStyle["-webkit-text-stroke-width"]) > 0, "no-backdrop presets keep their readable outline")
    await player.screenshot({ path: `${output}/${variant.preset}.png` })
  }
  await presets.getByRole("button", { name: "Warm gold", exact: true }).click()
  await settings.locator(".subtitle-custom > summary").click()
  await settings.locator("#features").getByRole("group", { name: "Translation font", exact: true }).getByRole("button", { name: "Default (sans serif)", exact: true }).click()
  const color = settings.getByRole("textbox", { name: "Translation color hex value", exact: true })
  await color.fill("#ABCDEF")
  await color.press("Enter")
  await waitForStoredConfig(context, config => config.features.subtitleStyle.translationFont === "sans" && config.features.subtitleStyle.translationColor === "#abcdef")
  await waitForTypography(state => state.translationStyle?.color === "rgb(171, 205, 239)" && state.translationStyle["font-family"].includes("system-ui"))
  assert.equal(await presets.getByRole("button", { name: "Warm gold", exact: true }).getAttribute("aria-pressed"), "false")
  const saved = (await storedConfig(context)).features.subtitleStyle
  await color.fill("#GGGGGG")
  await color.blur()
  await settings.getByRole("alert").waitFor()
  assert.deepEqual((await storedConfig(context)).features.subtitleStyle, saved, "invalid drafts cannot change saved appearance")
  await color.press("Escape")
  assert.equal(await color.inputValue(), "#ABCDEF")
  await settings.reload()
  await settings.locator(".subtitle-custom > summary").click()
  await settings.locator("#features").getByRole("group", { name: "Translation font", exact: true }).getByRole("button", { name: "Default (sans serif)", exact: true, pressed: true }).waitFor()
  assert.equal(await color.inputValue(), "#ABCDEF")
  await presets.getByRole("button", { name: "Warm gold", exact: true }).click()
  await waitForStoredConfig(context, config => config.features.subtitleStyle.translationFont === "serif" && config.features.subtitleStyle.translationColor === "#ffe0a0" && config.features.subtitleStyle.originalFontScale === 100)
  await waitForTypography(state => state.translationStyle?.color === "rgb(255, 224, 160)")
  // Capture the implemented Chinese settings, independently of the test's English control names.
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.ui.language = "zh-CN"
    await chrome.storage.local.set({ config })
  })
  await settings.reload()
  await settings.getByRole("link", { name: "视频字幕", exact: true }).click()
  await settings.locator(".subtitle-custom > summary").click()
  await settings.setViewportSize({ width: 1280, height: 1000 })
  await settings.screenshot({ path: `${output}/settings.png`, fullPage: true })
  await settings.setViewportSize({ width: 390, height: 900 })
  assert.ok(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "font and color controls fit the narrow settings page")
  await settings.screenshot({ path: `${output}/settings-mobile.png`, fullPage: true })

  // Exercise the real player popover, whose controls live in a closed shadow root.
  const playerControl = async (predicate) => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    const host = find(root, node => attr(node, "data-readomi-video-controls") !== undefined)
    const node = find(host?.shadowRoots[0], predicate)
    assert.ok(node, "the requested player style control exists")
    return node
  }
  const withPlayerControl = async (predicate, functionDeclaration, arguments_ = []) => {
    const node = await playerControl(predicate)
    const { object } = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId })
    try {
      return (await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration, arguments: arguments_, returnByValue: true })).result.value
    }
    finally {
      await cdp.send("Runtime.releaseObject", { objectId: object.objectId })
    }
  }
  const clickPlayerControl = async (predicate) => {
    const node = await playerControl(predicate)
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId })
    await player.mouse.click((model.border[0] + model.border[2]) / 2, (model.border[1] + model.border[5]) / 2)
  }
  const menuState = () => withPlayerControl(node => attr(node, "class") === "panel", `function() {
    return { background: this.querySelector('.background-range').value, color: this.querySelector('.color-picker').value,
      hex: this.querySelector('.color-custom output').textContent, scrollable: this.scrollHeight > this.clientHeight,
      bounds: this.getBoundingClientRect().toJSON() };
  }`)
  await clickPlayerControl(node => attr(node, "class") === "trigger")
  assert.equal((await menuState()).background, "0")
  assert.equal((await menuState()).color, "#ffe0a0")
  await player.screenshot({ path: `${output}/player-popup.png` })
  await withPlayerControl(node => attr(node, "class") === "background-range", "function() { this.focus(); }")
  await player.keyboard.press("Home")
  for (let i = 0; i < 6; i++)
    await player.keyboard.press("PageUp")
  await waitForStoredConfig(context, config => config.features.subtitleStyle.backgroundEnabled && config.features.subtitleStyle.backgroundOpacity === 60)
  await clickPlayerControl(node => attr(node, "data-color") === "#bfe6df")
  await waitForStoredConfig(context, config => config.features.subtitleStyle.translationColor === "#bfe6df")
  const adjusted = await waitForTypography(state => state.translationStyle?.color === "rgb(191, 230, 223)" && state.boxStyle?.["background-color"] === "rgba(15, 20, 35, 0.6)")
  assert.equal(adjusted.originalStyle.color, "rgb(255, 247, 233)", "player color edits affect only the translation")
  assert.equal(adjusted.boxStyle["font-size"], "18.9px", "background and color edits preserve the user's caption size")
  await settings.setViewportSize({ width: 1280, height: 1000 })
  assert.equal(await settings.getByRole("spinbutton", { name: "背景深度", exact: true }).inputValue(), "60")
  assert.equal(await settings.getByRole("textbox", { name: "译文颜色色值", exact: true }).inputValue(), "#BFE6DF")
  await player.screenshot({ path: `${output}/player-popup-adjusted.png` })
  await withPlayerControl(node => attr(node, "class") === "color-picker", `function(color) {
    this.value = color;
    this.dispatchEvent(new this.ownerDocument.defaultView.Event('input', { bubbles: true, composed: true }));
  }`, [{ value: "#abcdef" }])
  await waitForStoredConfig(context, config => config.features.subtitleStyle.translationColor === "#abcdef")
  await waitForTypography(state => state.translationStyle?.color === "rgb(171, 205, 239)")
  assert.equal((await menuState()).hex, "#ABCDEF")
  await settings.reload()
  await settings.locator(".subtitle-custom > summary").click()
  assert.equal(await settings.getByRole("textbox", { name: "译文颜色色值", exact: true }).inputValue(), "#ABCDEF")
  await settings.getByRole("group", { name: "字幕预设", exact: true }).getByRole("button", { name: "暖金", exact: true }).click()
  await waitForStoredConfig(context, config => config.features.subtitleStyle.backgroundOpacity === 0 && config.features.subtitleStyle.translationColor === "#ffe0a0")
  assert.equal((await menuState()).background, "0")
  assert.equal((await menuState()).color, "#ffe0a0")
  // A narrow video scrolls the popover instead of hiding its last controls.
  await player.setViewportSize({ width: 390, height: 700 })
  await player.locator("#player").evaluate((element) => {
    element.style.width = "310px"
    element.style.height = "174.375px"
  })
  const narrow = await menuState()
  assert.ok(narrow.scrollable)
  assert.ok(narrow.bounds.left >= 40 && narrow.bounds.right <= 350 && narrow.bounds.top >= 86 && narrow.bounds.bottom <= 86 + 174.375)
  await waitForTypography(state => Math.abs(Number.parseFloat(state.boxStyle?.["font-size"]) - 174.375 * 0.035) < 0.01)
  await withPlayerControl(node => attr(node, "class") === "color-picker", "function() { this.focus(); }")
  await player.screenshot({ path: `${output}/player-popup-mobile.png` })
  await withPlayerControl(node => attr(node, "class") === "background-range", "function() { this.focus(); }")
  await player.keyboard.press("End")
  await waitForStoredConfig(context, config => config.features.subtitleStyle.backgroundEnabled && config.features.subtitleStyle.backgroundOpacity === 100)
  await player.keyboard.press("Home")
  await waitForStoredConfig(context, config => !config.features.subtitleStyle.backgroundEnabled && config.features.subtitleStyle.backgroundOpacity === 0)
})
