/* global chrome */
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import process from "node:process"
import { it } from "node:test"
import { configureService, launchBrowser } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

it("YouTube subtitles stay synchronized after a slow model response, seek immediately and hide ads", async () => {
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
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ events }) })
        return
      }
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>Subtitle playback fixture</title><style>body{background:#faf8f5}.html5-video-player{width:640px;margin:40px auto;position:relative;background:#302b29}video{width:640px;height:360px}.ytp-caption-window-container{position:absolute;bottom:40px;left:100px;color:white}</style><div class="html5-video-player"><video src="/video.wav" muted autoplay></video><div class="ytp-caption-window-container"><span class="ytp-caption-segment">Native caption</span></div></div><script>
const player = document.querySelector('.html5-video-player');
player.getPlayerResponse = () => ({videoDetails:{videoId:'readomi-fixture'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=readomi-fixture&lang=en',languageCode:'en',vssId:'.en'}]}}});
player.getOption = () => ({languageCode:'en',vssId:'.en'});
fetch('https://www.youtube.com/api/timedtext?v=readomi-fixture&lang=en&pot=fixture-proof');
</script>` })
    })
    const cdp = await context.newCDPSession(page)
    const snapshot = async () => {
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
      const find = (node, predicate) => predicate(node) ? node : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(child => find(child, predicate)).find(Boolean)
      const attr = (node, name) => {
        const index = node.attributes?.indexOf(name) ?? -1
        return index >= 0 ? node.attributes[index + 1] : undefined
      }
      const text = node => node ? node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join("") : ""
      const host = find(root, node => attr(node, "data-readomi-subtitles") !== undefined)
      const shadow = host?.shadowRoots?.[0]
      if (!shadow)
        return {}
      const box = find(shadow, node => attr(node, "class")?.split(" ").includes("box"))
      const original = find(shadow, node => attr(node, "class") === "original")
      return { original: text(original), text: text(box), hidden: attr(box, "class")?.split(" ").includes("empty") }
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
    if (process.env.SUBTITLE_SCREENSHOT) {
      await page.evaluate(() => document.querySelector(".html5-video-player").classList.remove("ad-showing"))
      await waitForSubtitle(state => state.hidden === false)
      await page.screenshot({ path: process.env.SUBTITLE_SCREENSHOT })
    }
  }
  finally {
    release?.()
    await context?.close()
    await service.close()
  }
})
