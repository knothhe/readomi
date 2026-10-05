/* global chrome */
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import process from "node:process"
import { it } from "node:test"
import { configureService, launchBrowser, storedConfig } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

async function subtitlePlayback(transcriptFormat) {
  const service = await startFakeService()
  let context
  let release
  try {
    const launched = await launchBrowser()
    context = launched.context
    const { page, extensionId } = launched
    await configureService(page, extensionId, setupDocumentFor(service.origin))
    const worker = context.serviceWorkers()[0]
    await worker.evaluate(async () => {
      const { config } = await chrome.storage.local.get("config")
      config.features.videoSubtitles = true
      await chrome.storage.local.set({ config })
    })
    // A silent PCM track gives the real media element a clock and a seekable duration.
    const media = Buffer.alloc(44 + 8000 * 120, 128)
    media.write("RIFF", 0)
    media.writeUInt32LE(media.length - 8, 4)
    media.write("WAVEfmt ", 8)
    media.writeUInt32LE(16, 16)
    media.writeUInt16LE(1, 20)
    media.writeUInt16LE(1, 22)
    media.writeUInt32LE(8000, 24)
    media.writeUInt32LE(8000, 28)
    media.writeUInt16LE(1, 32)
    media.writeUInt16LE(8, 34)
    media.write("data", 36)
    media.writeUInt32LE(media.length - 44, 40)
    const events = Array.from({ length: 60 }, (_, i) => ({ tStartMs: i * 2000, dDurationMs: 2000, segs: [{ utf8: `Sentence ${i}.` }] }))
    await context.route("https://www.youtube.com/**", async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === "/video.wav") {
        const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/)
        const start = range ? Number(range[1]) : 0
        const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1
        await route.fulfill({
          status: range ? 206 : 200,
          contentType: "audio/wav",
          headers: { "accept-ranges": "bytes", ...(range ? { "content-range": `bytes ${start}-${end}/${media.length}` } : {}) },
          body: media.subarray(start, end + 1),
        })
        return
      }
      if (url.pathname === "/api/timedtext") {
        const body = transcriptFormat === "json3"
          ? JSON.stringify({ events })
          : transcriptFormat === "srv3"
            ? `<timedtext><body>${events.map(event => `<p t="${event.tStartMs}" d="${event.dDurationMs}"><s>${event.segs[0].utf8}</s></p>`).join("")}</body></timedtext>`
            : `<transcript>${events.map(event => `<text start="${event.tStartMs / 1000}" dur="${event.dDurationMs / 1000}">${event.segs[0].utf8}</text>`).join("")}</transcript>`
        await route.fulfill({ contentType: transcriptFormat === "json3" ? "application/json" : "text/xml", body })
        return
      }
      await route.fulfill({ headers: { "content-security-policy": "require-trusted-types-for 'script'; trusted-types 'none'" }, contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>Subtitle playback fixture</title><style>body{background:#faf8f5}.html5-video-player{width:640px;margin:40px auto;position:relative;background:#302b29}video{display:block;width:640px;height:360px}.html5-video-player:fullscreen{width:100vw;height:100vh;margin:0;--yt-delhi-bottom-controls-height:96px}.html5-video-player:fullscreen video{position:absolute;top:12.5vh;width:100vw;height:75vh}.ytp-chrome-bottom{position:absolute;bottom:4px;left:0;width:100%;height:40px;background:#0008;color:white}.ytp-progress-bar-container{position:absolute;top:-4px;left:12px;right:12px;height:4px;background:#f03}.ytp-left-controls{position:absolute;left:12px;top:0;height:100%;display:flex;align-items:center;gap:8px}.ytp-right-controls{position:absolute;right:12px;top:0;height:100%;display:flex;align-items:center;gap:10px}.ytp-autohide .ytp-chrome-bottom{opacity:0;pointer-events:none}.ytp-caption-window-container{position:absolute;inset:0}.caption-window.ytp-caption-window-bottom{position:absolute;bottom:2%;left:100px;color:white;margin-bottom:calc(var(--yt-delhi-bottom-controls-height,40px) + 14px)}.ytp-autohide .caption-window.ytp-caption-window-bottom{margin-bottom:0}</style><div id="movie_player" class="html5-video-player ytp-autohide"><video src="/video.wav" muted autoplay></video><div class="ytp-chrome-bottom"><div class="ytp-progress-bar-container"></div><div class="ytp-left-controls"><span>Ⅱ</span><span>1:32 / 2:00</span></div><div class="ytp-right-controls"><span>⚙</span><span>⛶</span></div></div><div class="ytp-caption-window-container"><div class="caption-window ytp-caption-window-bottom"><span class="ytp-caption-segment">Native caption</span></div></div></div><script>
const player = document.querySelector('.html5-video-player');
player.getPlayerResponse = () => ({videoDetails:{videoId:'readomi-fixture'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=readomi-fixture&lang=en',languageCode:'en',vssId:'.en'}]}}});
player.getOption = () => ({languageCode:'en',vssId:'.en'});
fetch('https://www.youtube.com/api/timedtext?v=readomi-fixture&lang=en&pot=fixture-proof');
</script>` })
    })
    const cdp = await context.newCDPSession(page)
    const find = (node, predicate) => predicate(node) ? node : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(child => find(child, predicate)).find(Boolean)
    const attr = (node, name) => {
      const index = node.attributes?.indexOf(name) ?? -1
      return index >= 0 ? node.attributes[index + 1] : undefined
    }
    const bounds = async (node) => {
      const model = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId }).catch(() => null)
      if (!model)
        return null
      const quad = model.model.border
      return { left: quad[0], top: quad[1], right: quad[2], bottom: quad[5] }
    }
    const controlBounds = async (label) => {
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
      return bounds(find(root, node => attr(node, "aria-label") === label))
    }
    const snapshot = async () => {
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
      const text = node => node ? node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join("") : ""
      const host = find(root, node => attr(node, "data-readomi-subtitles") !== undefined)
      const shadow = host?.shadowRoots?.[0]
      if (!shadow)
        return {}
      const box = find(shadow, node => attr(node, "class")?.split(" ").includes("box"))
      const original = find(shadow, node => attr(node, "class") === "original")
      return { original: text(original), text: text(box), hidden: attr(box, "class")?.split(" ").includes("empty"), bounds: await bounds(box) }
    }
    const waitForSubtitle = async (predicate) => {
      const deadline = Date.now() + 15000
      let state
      while (Date.now() < deadline) {
        state = await snapshot()
        if (predicate(state))
          return state
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error(`Subtitle state timed out: ${JSON.stringify(state)}`)
    }
    const waitForStoredConfig = async (predicate) => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const config = await storedConfig(context)
        if (predicate(config))
          return config
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error("Subtitle configuration was not saved")
    }
    const waitForStoredStyle = async predicate => (await waitForStoredConfig(config => predicate(config.features.subtitleStyle))).features.subtitleStyle
    release = service.holdAnswers()
    await page.goto("https://www.youtube.com/watch?v=readomi-fixture")
    await waitForSubtitle(state => state.text?.includes("Preparing subtitle translations"))
    // The first cue lasts two seconds; keep the model busy longer than that.
    await page.waitForFunction(() => document.querySelector("video").currentTime >= 3)
    release()
    release = undefined
    await waitForSubtitle(state => state.original?.startsWith("Sentence ") && state.original !== "Sentence 0." && state.text.includes(`【译】${state.original}`))
    assert.equal(await page.evaluate(() => document.querySelector("video").paused), false)
    const messages = service.translationRequests().map(items => items.at(-1).content).join("\n")
    assert.match(messages, /Sentence 5\./, "future cues reached the model before being displayed")
    await page.evaluate(() => document.querySelector("video").currentTime = 90)
    await waitForSubtitle(state => state.text?.includes("【译】Sentence 45."))
    await page.evaluate(() => document.querySelector(".html5-video-player").classList.add("ad-showing"))
    await waitForSubtitle(state => state.hidden)
    await page.evaluate(() => document.querySelector(".html5-video-player").classList.remove("ad-showing"))
    await waitForSubtitle(state => state.hidden === false)
    const videoBounds = await page.locator("video").boundingBox()
    await waitForSubtitle(state => state.bounds && Math.abs(state.bounds.bottom - (videoBounds.y + videoBounds.height * 0.98)) < 0.5)
    if (process.env.SUBTITLE_EDGE_SCREENSHOT)
      await page.screenshot({ path: process.env.SUBTITLE_EDGE_SCREENSHOT })
    await page.evaluate(() => document.querySelector(".html5-video-player").classList.remove("ytp-autohide"))
    await waitForSubtitle(state => state.bounds && Math.abs(state.bounds.bottom - (videoBounds.y + videoBounds.height * 0.98 - 54)) < 0.5)
    if (process.env.SUBTITLE_CONTROLS_SCREENSHOT)
      await page.screenshot({ path: process.env.SUBTITLE_CONTROLS_SCREENSHOT })
    assert.deepEqual((await storedConfig(context)).features.subtitleStyle.position, { x: 50, y: 88 }, "control visibility does not rewrite the saved preset")
    await page.evaluate(() => {
      document.querySelector(".ytp-caption-window-container .caption-window").remove()
      document.querySelector(".html5-video-player").classList.add("ytp-autohide")
    })
    await waitForSubtitle(state => state.bounds && Math.abs(state.bounds.bottom - (videoBounds.y + videoBounds.height * 0.98)) < 0.5)
    await page.evaluate(() => document.querySelector(".html5-video-player").requestFullscreen())
    const fullscreenEdge = await page.locator(".html5-video-player").boundingBox()
    await waitForSubtitle(state => state.bounds && Math.abs(state.bounds.bottom - (fullscreenEdge.y + fullscreenEdge.height * 0.98)) < 0.5)
    await page.evaluate(() => document.querySelector(".html5-video-player").classList.remove("ytp-autohide"))
    await waitForSubtitle(state => state.bounds && Math.abs(state.bounds.bottom - (fullscreenEdge.y + fullscreenEdge.height * 0.98 - 110)) < 0.5)
    await page.evaluate(() => {
      document.querySelector(".html5-video-player").classList.add("ytp-autohide")
      document.exitFullscreen()
    })
    await waitForSubtitle(state => state.bounds && Math.abs(state.bounds.bottom - (videoBounds.y + videoBounds.height * 0.98)) < 0.5)
    await page.evaluate(() => document.querySelector(".html5-video-player").classList.remove("ytp-autohide"))
    await waitForSubtitle(state => state.bounds && Math.abs(state.bounds.bottom - (videoBounds.y + videoBounds.height * 0.98 - 54)) < 0.5)
    const preset = await controlBounds("Adjust subtitle preset")
    await page.mouse.click((preset.left + preset.right) / 2, (preset.top + preset.bottom) / 2)
    const beforeIncrease = (await storedConfig(context)).features.subtitleStyle
    assert.equal(beforeIncrease.fontSizeMode, "video", "the default preset scales with the video window")
    const plus = await controlBounds("Increase subtitle size")
    await page.mouse.click((plus.left + plus.right) / 2, (plus.top + plus.bottom) / 2)
    await waitForStoredStyle(style => style.fontSizeMode === "video" && style.relativeFontSize === beforeIncrease.relativeFontSize + 0.25 && style.fontSize === beforeIncrease.fontSize)
    const closePreset = await controlBounds("Adjust subtitle preset")
    await page.mouse.click((closePreset.left + closePreset.right) / 2, (closePreset.top + closePreset.bottom) / 2)
    await page.mouse.click(4, 4)
    await page.evaluate(() => document.querySelector(".html5-video-player").classList.add("ytp-autohide"))
    await waitForSubtitle(state => state.bounds && Math.abs(state.bounds.bottom - (videoBounds.y + videoBounds.height * 0.98)) < 0.5)
    const beforeDrag = (await snapshot()).bounds
    const x = (beforeDrag.left + beforeDrag.right) / 2
    const y = (beforeDrag.top + beforeDrag.bottom) / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 80, y - 60, { steps: 8 })
    await page.mouse.up()
    const moved = await waitForStoredStyle(style => Math.abs(style.position.x - 37.5) < 0.5 && Math.abs(style.position.y - ((beforeDrag.bottom - videoBounds.y - 60) / videoBounds.height * 100)) < 0.5)
    assert.equal(await page.evaluate(() => document.querySelector("video").paused), false, "dragging does not pause playback")
    await page.evaluate(() => document.querySelector(".html5-video-player").requestFullscreen())
    const fullscreen = await page.locator("video").boundingBox()
    await waitForSubtitle(state => state.bounds && Math.abs(((state.bounds.left + state.bounds.right) / 2 - fullscreen.x) / fullscreen.width * 100 - moved.position.x) < 0.5)
    await page.evaluate(() => document.exitFullscreen())
    const normalVideo = await page.locator("video").boundingBox()
    await waitForSubtitle(state => state.bounds && Math.abs(((state.bounds.left + state.bounds.right) / 2 - normalVideo.x) / normalVideo.width * 100 - moved.position.x) < 0.5)
    if (process.env.SUBTITLE_SCREENSHOT) {
      await page.screenshot({ path: process.env.SUBTITLE_SCREENSHOT })
    }
    const popup = await context.newPage()
    await popup.setViewportSize({ width: 320, height: 460 })
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.locator("summary").filter({ hasText: "Video subtitles" }).click()
    const webMode = popup.getByRole("group", { name: "Web text display mode" })
    const subtitleMode = popup.getByRole("group", { name: "Subtitle display mode" })
    await webMode.getByRole("button", { name: "Translation only", exact: true }).click()
    await popup.waitForFunction(() => document.querySelector("section[aria-label=\"Web text\"] button[aria-pressed=\"true\"]")?.textContent.includes("Translation only"))
    assert.equal((await waitForStoredConfig(config => config.translate.mode === "translationOnly")).features.subtitleMode, "bilingual")
    if (process.env.POPUP_SCREENSHOT)
      await popup.screenshot({ path: process.env.POPUP_SCREENSHOT, animations: "disabled" })
    await subtitleMode.getByRole("button", { name: "Translation only", exact: true }).click()
    await webMode.getByRole("button", { name: "Bilingual", exact: true }).click()
    const finalConfig = await waitForStoredConfig(config => config.features.subtitleMode === "translationOnly" && config.translate.mode === "bilingual")
    assert.equal(finalConfig.features.subtitleMode, "translationOnly")
    assert.equal(finalConfig.translate.mode, "bilingual")
    assert.deepEqual(finalConfig.features.subtitleStyle, moved)
    await popup.reload()
    await popup.locator("summary").filter({ hasText: "Video subtitles" }).click()
    await popup.waitForFunction(() => {
      const groups = [...document.querySelectorAll("[role=\"group\"]")]
      const selected = label => groups.find(group => group.getAttribute("aria-label") === label)?.querySelector("[aria-pressed=\"true\"]")?.textContent
      return selected("Web text display mode") === "Bilingual" && selected("Subtitle display mode") === "Translation only"
    })
  }
  finally {
    release?.()
    await context?.close()
    await service.close()
  }
}

for (const format of ["json3", "srv3", "legacy"]) {
  it(`YouTube ${format} subtitles under Trusted Types preserve preloading, appearance and web modes`, () => subtitlePlayback(format))
}
