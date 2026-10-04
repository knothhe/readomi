/* global chrome -- config callbacks run in the extension page. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { launchBrowser, reportFailure } from "./browser.mjs"

let context
afterEach(async (test) => {
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    context = undefined
  }
})

// The media stays paused at zero. Geometry changes are independent of playback,
// caption changes and translation requests, which might otherwise mask polling.
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><title>X subtitle scroll fixture</title>
<style>
html{scroll-behavior:auto}body{margin:0;min-height:2400px;background:#111;color:#eee;font:16px system-ui}h1{margin:0;padding:24px;font-size:20px}
#scroller{width:min(720px,calc(100vw - 48px));height:680px;margin:100px auto 0;overflow:auto;overflow-anchor:none;border:1px solid #333;scroll-behavior:auto}
#feed{min-height:1800px;padding-top:160px}article{width:calc(100% - 80px);max-width:640px;margin:0 auto}article>a{display:block;height:24px;color:inherit}
#player{position:relative;width:100%;aspect-ratio:16/9;background:#302b29}video{display:block;width:100%;height:100%}
.controls{box-sizing:border-box;position:absolute;bottom:0;left:0;width:100%;height:60px;background:#0006;color:white;display:flex;align-items:center;padding:12px;gap:16px}.controls>span{margin-right:auto}.controls button{color:white;background:transparent;border:0}
</style><h1>X video subtitle scrolling</h1><div id="scroller"><div id="feed"><article>
<a href="https://x.com/readomi/status/1234567890"><time>Today</time></a>
<div id="player" data-testid="videoComponent"><video aria-label="Embedded video"></video>
<div class="controls" data-testid="videoControls"><button type="button" aria-label="Pause">Ⅱ</button><span>0:00 / 1:00</span><button type="button" aria-label="Fullscreen">⛶</button></div>
</div></article></div></div>
<script>const video=document.querySelector('video');const source=video.addTextTrack('subtitles','English','en');source.mode='disabled';source.addCue(new VTTCue(0,60,'The caption follows the video while scrolling.'));window.e2eSubtitleTrack=source;</script></html>`

// Read the host's actual painted bounds: its closed-shadow caption ends at the
// host's bottom edge. Sampling does not need to expose or modify the shadow root.
async function followWhileScrolling(page, target, direction = 1) {
  return page.evaluate(async ({ target, direction }) => {
    const scroller = target === "window" ? window : document.querySelector("#scroller")
    const afterFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
    const host = document.querySelector("[data-readomi-subtitles]")
    const video = document.querySelector("video")
    const controls = document.querySelector(".controls")
    const start = performance.now()
    const samples = []
    for (let frame = 0; frame < 12; frame++) {
      scroller.scrollBy(0, direction * 8)
      // Scroll events precede the frame's animation callbacks. Read after those
      // callbacks have run, while the next scroll step is still in progress.
      await afterFrame()
      const caption = host.getBoundingClientRect()
      const player = video.getBoundingClientRect()
      const toolbar = controls.getBoundingClientRect()
      samples.push({
        frame,
        elapsed: performance.now() - start,
        scroll: target === "window" ? scrollY : scroller.scrollTop,
        captionBottom: caption.bottom,
        captionCentre: caption.left + caption.width / 2,
        captionHeight: caption.height,
        videoTop: player.top,
        videoBottom: player.bottom,
        expectedBottom: player.top + player.height * 0.98 - Math.min(toolbar.height, player.height * 0.25),
        expectedCentre: player.left + player.width / 2,
        controlsTop: toolbar.top,
      })
    }
    return samples
  }, { target, direction })
}

function assertFollows(samples, target) {
  assert.ok(samples.filter(sample => sample.elapsed < 250).length >= 3, `${target}: capture moving frames before the old 250 ms polling interval`)
  assert.notEqual(samples[0].scroll, samples.at(-1).scroll, `${target}: the scrolling fixture actually moves`)
  assert.notEqual(samples[0].videoTop, samples.at(-1).videoTop, `${target}: scrolling moves the video in the viewport`)
  for (const sample of samples) {
    const message = `${target} scrolling frame ${sample.frame}: ${JSON.stringify(sample)}`
    assert.ok(sample.captionHeight > 0, `the source caption stays visible; ${message}`)
    assert.ok(Math.abs(sample.captionBottom - sample.expectedBottom) < 0.75, `caption follows the video's bottom clearance during motion; ${message}`)
    assert.ok(Math.abs(sample.captionCentre - sample.expectedCentre) < 0.75, `caption stays centred on the moving video; ${message}`)
    assert.ok(sample.captionBottom < sample.controlsTop, `caption remains above the playback controls; ${message}`)
  }
}

it("X subtitles follow each window and nested scroll frame, resize and clean up when disabled", async () => {
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await settings.goto(`chrome-extension://${launched.extensionId}/options.html#features`)
  await settings.waitForFunction(async () => Boolean((await chrome.storage.local.get("config")).config))
  // Storage only prepares the feature state; this test targets rendered geometry.
  // Empty keys make the translation failure local, with no provider API request.
  await settings.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.videoSubtitles = true
    config.features.videoExcludedSites = []
    config.features.subtitleMode = "bilingual"
    config.features.subtitleStyle.position = { x: 50, y: 88 }
    for (const provider of config.providersConfig)
      provider.apiKey = ""
    await chrome.storage.local.set({ config })
  })
  await context.route("https://x.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }))
  const page = await context.newPage()
  await page.setViewportSize({ width: 1000, height: 1000 })
  await page.goto("https://x.com/home")
  await page.waitForFunction(() => {
    const host = document.querySelector("[data-readomi-subtitles]")
    const video = document.querySelector("video")
    const controls = document.querySelector(".controls")
    if (!host || !video || !controls)
      return false
    const caption = host.getBoundingClientRect()
    const player = video.getBoundingClientRect()
    const expected = player.top + player.height * 0.98 - Math.min(controls.getBoundingClientRect().height, player.height * 0.25)
    return caption.height > 0 && Math.abs(caption.bottom - expected) < 0.75
  })
  assert.equal(await page.evaluate(() => document.querySelector("video").paused), true, "a paused media clock cannot conceal missing scroll positioning")
  await page.waitForFunction(() => window.e2eSubtitleTrack.mode === "hidden")

  assertFollows(await followWhileScrolling(page, "window"), "window down")
  assertFollows(await followWhileScrolling(page, "window", -1), "window up")
  // Element scroll events do not bubble. This catches a window listener that
  // forgets capture mode even if the ordinary document scroll case succeeds.
  assertFollows(await followWhileScrolling(page, "nested"), "nested down")
  assertFollows(await followWhileScrolling(page, "nested", -1), "nested up")

  await page.setViewportSize({ width: 620, height: 1000 })
  const resized = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
    const caption = document.querySelector("[data-readomi-subtitles]").getBoundingClientRect()
    const player = document.querySelector("video").getBoundingClientRect()
    const toolbar = document.querySelector(".controls").getBoundingClientRect()
    return {
      bottom: caption.bottom,
      centre: caption.left + caption.width / 2,
      expectedBottom: player.top + player.height * 0.98 - Math.min(toolbar.height, player.height * 0.25),
      expectedCentre: player.left + player.width / 2,
      controlsTop: toolbar.top,
    }
  })
  assert.ok(Math.abs(resized.bottom - resized.expectedBottom) < 0.75, `resize updates bottom clearance in the next frame: ${JSON.stringify(resized)}`)
  assert.ok(Math.abs(resized.centre - resized.expectedCentre) < 0.75, "resize keeps subtitles centred on the responsive player")
  assert.ok(resized.bottom < resized.controlsTop, "resize preserves clearance above native controls")

  await page.evaluate(() => {
    window.e2eRetiredSubtitleHost = document.querySelector("[data-readomi-subtitles]")
  })
  await settings.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.videoSubtitles = false
    await chrome.storage.local.set({ config })
  })
  await page.waitForFunction(() => !document.querySelector("[data-readomi-subtitles]") && window.e2eSubtitleTrack.mode === "disabled")
  const afterDisabling = await page.evaluate(async () => {
    const host = window.e2eRetiredSubtitleHost
    const before = host.getAttribute("style")
    for (let frame = 0; frame < 6; frame++) {
      window.scrollBy(0, 8)
      document.querySelector("#scroller").scrollBy(0, 8)
      window.dispatchEvent(new Event("resize"))
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
    }
    return { before, after: host.getAttribute("style"), reattached: host.isConnected, count: document.querySelectorAll("[data-readomi-subtitles]").length }
  })
  assert.equal(afterDisabling.count, 0, "scroll and resize do not recreate a disabled caption")
  assert.equal(afterDisabling.reattached, false, "the previous caption remains detached after scrolling")
  assert.equal(afterDisabling.after, afterDisabling.before, "scroll and resize no longer mutate the retired caption")
})
