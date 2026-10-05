/* global chrome -- config callbacks run in the extension page. */
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
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

const icon = "<div><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M5 4h14v16H5z\"/></svg></div>"
const button = (label, attributes = "") => `<button type="button" role="button" aria-label="${label}" ${attributes}>${icon}</button>`
function bottomControls(generation) {
  return `<div class="native-chrome" data-generation="${generation}">
  <div role="slider" aria-label="Video progress" aria-valuemin="0" aria-valuemax="60" aria-valuenow="2" class="progress"></div>
  <div class="native-row"><div class="left-group">${button("Pause")}<span>0:02 / 1:00</span></div><div class="spacer"></div>
    <div class="right-group">${["Unmute", "Settings", "Picture in picture", "Fullscreen"].map(label => `<div class="native-tool">${button(label)}</div>`).join("")}</div>
  </div>
</div>`
}
// Match X's native button nesting and column/row groups without the explicit
// videoControls test id. The advertisement's SVG occurs before the playback SVGs.
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><title>X advertisement toolbar fixture</title>
<style>
body{margin:0;background:#000;color:#eee;font:14px system-ui}h1,article{width:519px;margin:24px auto}h1{font-size:20px}
#player{position:relative;width:519px;height:292px;background:linear-gradient(135deg,#3a4149,#25303c);overflow:hidden;border-radius:16px}
video{display:block;width:100%;height:100%}button{padding:0;border:0;color:inherit;background:transparent;cursor:pointer}button>div{display:flex;align-items:center;justify-content:center}svg{width:20px;height:20px}
.advertisement{position:absolute;top:0;left:0;width:100%;padding:12px;box-sizing:border-box}.ad-row{display:flex;align-items:center;gap:12px;width:100%;height:40px}.ad-row a{flex:1;color:inherit;text-decoration:none;background:#0009;padding:10px 14px;border-radius:24px}.ad-menu button{width:32px;height:32px;background:#0008;border-radius:6px}
.native-chrome{position:absolute;bottom:0;left:0;box-sizing:border-box;width:100%;padding:0 6px 4px;display:flex;flex-direction:column;background:linear-gradient(transparent,#0008)}
.progress{height:3px;margin-bottom:3px;background:#ddd}.native-row{display:flex;align-items:center;width:100%;height:40px}.left-group,.right-group{display:flex;align-items:center;flex-shrink:0}.left-group{gap:8px}.left-group span{white-space:nowrap}.spacer{flex:1;min-width:0}.native-tool,.left-group>button{width:32px;height:32px}.native-tool button{width:100%;height:100%}.floating-mute{position:absolute;right:8px;bottom:8px;width:32px;height:32px;background:#0008;border-radius:50%}
</style><h1>X video with an advertisement</h1><article><a href="https://x.com/readomi/status/1234567890"><time>Today</time></a>
<div id="player" data-testid="videoComponent"><video aria-label="Embedded video"></video>
<div class="advertisement"><div class="ad-row"><a href="https://example.com">Visit the advertiser</a><div class="ad-menu">${button("More", "aria-haspopup=\"menu\"")}</div></div></div>
${bottomControls("original")}</div></article></html>`

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

async function screenshot(page, name) {
  if (!process.env.E2E_ARTIFACTS)
    return
  await mkdir(process.env.E2E_ARTIFACTS, { recursive: true })
  await page.screenshot({ path: resolve(process.env.E2E_ARTIFACTS, `${name}.png`), fullPage: true })
}

it("X controls stay in the native bottom row through advertisements, auto-hide and toolbar replacement", async () => {
  const launched = await launchBrowser()
  context = launched.context
  // Toolbar placement needs neither subtitle tracks nor a translation service.
  // Keep the global translation default off and exercise the real content script.
  await launched.page.goto(`chrome-extension://${launched.extensionId}/options.html#features`)
  await launched.page.waitForFunction(async () => Boolean((await chrome.storage.local.get("config")).config))
  await launched.page.evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.features.videoSubtitles = false
    config.features.videoExcludedSites = []
    await chrome.storage.local.set({ config })
  })
  await context.route("https://x.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }))
  const page = await context.newPage()
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.goto("https://x.com/home")
  assert.equal(await page.locator("[data-testid='videoControls']").count(), 0, "the fixture exercises X's unmarked real toolbar")

  const read = () => page.evaluate(() => {
    const hosts = [...document.querySelectorAll("[data-readomi-video-controls]")]
    const host = hosts[0]
    const row = document.querySelector(".native-row")
    const tools = row?.querySelector(".right-group")
    const video = document.querySelector("video")
    const rectangle = element => element?.getBoundingClientRect().toJSON()
    const hidden = element => element.hasAttribute("data-hidden") || element.hasAttribute("data-idle")
    return {
      count: hosts.length,
      hidden: hosts.every(hidden),
      inaccessible: hosts.every(element => element.hasAttribute("inert") && element.getAttribute("aria-hidden") === "true"),
      advertisementContainsHost: Boolean(document.querySelector(".advertisement [data-readomi-video-controls]")),
      floatingContainsHost: Boolean(document.querySelector(".floating-mute [data-readomi-video-controls]")),
      rowOwnsHost: host?.parentElement === row,
      beforeRightTools: host?.nextElementSibling === tools,
      generation: row?.parentElement.dataset.generation,
      placement: host?.dataset.placement,
      toolbar: host?.dataset.toolbar,
      dock: rectangle(host),
      row: rectangle(row),
      tools: rectangle(tools),
      video: rectangle(video),
    }
  })
  const visibleBottomSlot = state => state.count === 1 && !state.hidden && !state.inaccessible
    && state.rowOwnsHost && state.beforeRightTools && state.placement === "inline" && state.toolbar === "x"
    && state.dock.width > 0 && state.dock.height > 0
    && state.dock.left >= state.row.left - 0.5 && state.dock.right <= state.tools.left + 0.5
    && state.dock.top >= state.row.top - 0.5 && state.dock.bottom <= state.row.bottom + 0.5
    && state.tools.right <= state.row.right + 0.5
    && state.dock.top > state.video.top + state.video.height / 2
  await waitFor(read, visibleBottomSlot, "Readomi did not occupy the bottom row before the native right tools")
  const visibilitySwitch = launched.page.getByRole("switch", { name: "Show controls on videos", exact: true })
  await visibilitySwitch.click()
  await waitFor(read, state => state.count === 0, "settings did not hide X controls while translation was globally off")
  assert.equal(await page.locator("[data-readomi-controls-anchor]").count(), 0)
  await visibilitySwitch.click()
  await waitFor(read, visibleBottomSlot, "settings did not restore X controls while translation was globally off")
  assert.equal((await read()).advertisementContainsHost, false, "the earlier advertisement More button does not receive Readomi")
  await screenshot(page, "readomi-x-ad-bottom-toolbar")

  await page.locator(".advertisement").evaluate(ad => ad.style.opacity = "0")
  await page.waitForTimeout(350)
  assert.ok(visibleBottomSlot(await read()), "advertisement opacity does not hide the playback dock")
  await page.locator(".advertisement").evaluate(ad => ad.style.opacity = "1")
  await page.locator(".native-chrome").evaluate(chrome => chrome.style.opacity = "0")
  await waitFor(read, state => state.count === 1 && state.hidden && state.inaccessible && state.rowOwnsHost, "the dock did not become hidden and inert with its playback toolbar")
  assert.equal((await read()).advertisementContainsHost, false, "a visible advertisement cannot reclaim the hidden dock")
  await screenshot(page, "readomi-x-ad-toolbar-autohide")
  await page.locator(".native-chrome").evaluate(chrome => chrome.style.opacity = "1")
  await waitFor(read, visibleBottomSlot, "the dock did not return with its native playback toolbar")

  await page.locator(".native-chrome").evaluate(chrome => chrome.remove())
  await waitFor(read, state => state.hidden && state.inaccessible && !state.advertisementContainsHost, "advertisement-only playback incorrectly exposes Readomi")
  await screenshot(page, "readomi-x-ad-only-no-toolbar")
  await page.locator(".advertisement").evaluate(ad => ad.remove())
  await page.locator("#player").evaluate((player, markup) => player.insertAdjacentHTML("beforeend", markup), button("Unmute", "class=\"floating-mute\""))
  await page.waitForTimeout(350)
  const floating = await read()
  assert.ok(floating.hidden && floating.inaccessible && !floating.floatingContainsHost, "a lone floating mute button does not become a playback toolbar")

  await page.locator(".floating-mute").evaluate(button => button.remove())
  await page.locator("#player").evaluate((player, markup) => player.insertAdjacentHTML("beforeend", markup), bottomControls("replacement"))
  await waitFor(read, state => state.generation === "replacement" && visibleBottomSlot(state), "the replacement playback toolbar did not reclaim Readomi after the advertisement")
  assert.equal(await page.locator("[data-readomi-controls-anchor]").count(), 0, "replacement leaves no abandoned menu anchor")
  await screenshot(page, "readomi-x-replacement-bottom-toolbar")
})
