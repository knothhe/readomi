/* global chrome -- storage callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
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
    context = undefined
    service = undefined
  }
})

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

async function patchFeatures(patch) {
  await context.serviceWorkers()[0].evaluate(async (patch) => {
    const { config } = await chrome.storage.local.get("config")
    Object.assign(config.features, patch)
    await chrome.storage.local.set({ config })
  }, patch)
}

it("video exclusion settings validate, normalize and persist independent domain, URL and regex rules", async () => {
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await settings.setViewportSize({ width: 1280, height: 1380 })
  await settings.goto(`chrome-extension://${launched.extensionId}/options.html#features`)
  const section = settings.locator("#features").getByRole("region", { name: "Sites without video translation", exact: true })
  await section.getByRole("heading", { name: "Sites without video translation", exact: true }).waitFor()
  const input = section.getByRole("textbox", { name: "Site rule", exact: true })
  const add = section.getByRole("button", { name: "Add site", exact: true })
  const chooseType = async (name) => {
    await section.getByRole("combobox", { name: "Rule type", exact: true }).click()
    await settings.getByRole("option", { name, exact: true }).click()
  }
  const rules = () => storedConfig(context).then(config => config.features.videoExcludedSites)

  await input.fill(" EXAMPLE.com ")
  await add.click()
  await waitFor(rules, rules => rules.length === 1, "domain rule did not save")
  assert.deepEqual(await rules(), [{ type: "domain", value: "example.com" }])
  await waitFor(() => input.inputValue(), value => value === "", "saved domain input was not cleared")
  await input.fill("example.com")
  await add.click()
  await section.getByRole("alert").getByText("This rule already exists.", { exact: true }).waitFor()
  assert.equal((await rules()).length, 1)

  await chooseType("URL wildcard")
  await input.fill("ftp://example.com/*")
  await add.click()
  await section.getByRole("alert").getByText("Enter a valid site rule.", { exact: true }).waitFor()
  assert.equal((await rules()).length, 1, "unsupported URL schemes do not save")
  await input.fill("*.example.net/watch/*")
  await add.click()
  await waitFor(rules, rules => rules.length === 2, "URL wildcard did not save")
  assert.deepEqual((await rules())[1], { type: "pattern", value: "*://*.example.net/watch/*" })

  await chooseType("Regular expression")
  await input.fill("[")
  await add.click()
  await section.getByRole("alert").getByText("Enter a valid site rule.", { exact: true }).waitFor()
  assert.equal(await input.getAttribute("aria-invalid"), "true")
  assert.equal((await rules()).length, 2, "invalid regex keeps the saved list")
  const regex = "^https://([^.]+\\.)?example\\.org/"
  await input.fill(regex)
  await add.click()
  await waitFor(rules, rules => rules.length === 3, "regular expression did not save")
  assert.deepEqual((await rules())[2], { type: "regex", value: regex })
  await waitFor(() => input.inputValue(), value => value === "", "saved regex input was not cleared")
  await settings.screenshot({ path: "/tmp/readomi-video-exclusions.png", fullPage: true })
  await settings.setViewportSize({ width: 390, height: 900 })
  assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await settings.screenshot({ path: "/tmp/readomi-video-exclusions-mobile.png", fullPage: true })

  await section.locator("li").filter({ has: settings.getByText("example.com", { exact: true }) }).getByRole("button", { name: "Remove rule", exact: true }).click()
  await waitFor(rules, rules => rules.length === 2, "deleting a domain rule did not save")
  await settings.reload()
  await section.getByRole("heading", { name: "Sites without video translation", exact: true }).waitFor()
  assert.deepEqual(await rules(), [{ type: "pattern", value: "*://*.example.net/watch/*" }, { type: "regex", value: regex }])
  assert.equal(await section.getByText("example.com", { exact: true }).count(), 0)
})

const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Video translation controls fixture</title>
<style>body{margin:0;background:#faf8f5;color:#302b29;font:14px system-ui}h1{margin:20px auto;width:min(640px,calc(100% - 32px));font-size:20px}.html5-video-player{position:relative;width:min(640px,calc(100% - 32px));aspect-ratio:16/9;margin:20px auto;background:linear-gradient(120deg,#342b38,#252c38);overflow:hidden;border-radius:12px}video{display:block;width:100%;height:100%}.ytp-chrome-bottom{position:absolute;bottom:4px;left:0;width:100%;height:40px;background:#0008;color:white}.ytp-progress-bar-container{position:absolute;top:-4px;left:12px;right:12px;height:4px;background:#f03}.ytp-left-controls{display:inline-flex;align-items:center;gap:10px;width:max-content;height:40px;padding:0 12px}.ytp-left-controls button,.ytp-right-controls button{background:transparent;border:0;color:inherit;font:inherit;padding:0}.ytp-right-controls{position:absolute;right:12px;bottom:0;height:40px;display:flex;align-items:center;gap:10px}.ytp-caption-window-container{position:absolute;inset:0;pointer-events:none}.caption-window{position:absolute;left:12%;right:12%;bottom:2%;margin-bottom:54px;color:white;text-align:center}.html5-video-player:fullscreen{width:100vw;height:100vh;margin:0;border-radius:0}.ytp-autohide .ytp-chrome-bottom{opacity:0;pointer-events:none}.ytp-autohide .caption-window{margin-bottom:0}</style>
<h1>Video translation controls</h1><main id="movie_player">
<style>.modern .ytp-chrome-bottom{display:flex;align-items:center;box-sizing:border-box;padding:0 12px}.modern .ytp-left-controls{display:flex;flex:1 1 0%;min-width:0;width:auto;padding:0}.modern .ytp-right-controls{position:static;flex:0 1 auto;padding:0 4px;gap:0}.native-right-left,.native-right-right{display:flex;align-items:center;gap:10px}.native-right-left{margin-right:10px}</style>
${["first", "second"].map((id) => {
  const settings = "<button type=\"button\" aria-label=\"Settings\">⚙</button>"
  const pictureInPicture = "<button type=\"button\" aria-label=\"Picture in picture\">▣</button>"
  const fullscreen = "<button type=\"button\" aria-label=\"Fullscreen\">⛶</button>"
  const rightTools = id === "first" ? `<div class="native-right-left">${settings}${pictureInPicture}</div><div class="native-right-right">${fullscreen}</div>` : `${settings}${pictureInPicture}${fullscreen}`
  return `<div class="html5-video-player${id === "first" ? " modern" : ""}" id="${id}"><video aria-label="${id} video"></video><div class="ytp-chrome-bottom"><div class="ytp-progress-bar-container"></div><div class="ytp-left-controls"><button type="button" aria-label="Pause">Ⅱ</button><span>0:00 / 1:00</span></div><div class="ytp-right-controls">${rightTools}</div></div><div class="ytp-caption-window-container"><div class="caption-window ytp-caption-window-bottom"><span class="ytp-caption-segment">${id} native caption</span></div></div></div>`
}).join("")}
</main><script>window.e2eTracks=[...document.querySelectorAll('video')].map((video,index)=>{const track=video.addTextTrack('subtitles','English','en');track.mode='showing';track.addCue(new VTTCue(0,60,index===0?'First video sentence.':'Second video sentence.'));return track});</script></html>`

/** CDP traverses the real closed shadow DOM; pointer clicks still use browser input. */
async function playerInspector(page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send("DOM.enable")
  await cdp.send("CSS.enable")
  const attr = (node, name) => {
    const index = node?.attributes?.indexOf(name) ?? -1
    return index < 0 ? undefined : node.attributes[index + 1]
  }
  const nodes = node => node ? [node, ...(node.children ?? []).flatMap(nodes), ...(node.shadowRoots ?? []).flatMap(nodes)] : []
  const text = node => !node ? "" : node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join("")
  const root = async () => (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })).root
  // Opening a panel reparents its host above the captions. Backend node ids
  // survive that move, so player indices keep identifying the same videos.
  const hostOrder = []
  const orderedHosts = (root) => {
    const hosts = nodes(root).filter(node => attr(node, "data-readomi-video-controls") !== undefined)
    for (const host of hosts) {
      if (!hostOrder.includes(host.backendNodeId))
        hostOrder.push(host.backendNodeId)
    }
    return hosts.sort((a, b) => hostOrder.indexOf(a.backendNodeId) - hostOrder.indexOf(b.backendNodeId))
  }
  const bounds = async (node) => {
    if (!node)
      return undefined
    const model = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId }).catch(() => null)
    const q = model?.model.border
    return q && { left: q[0], top: q[1], right: q[2], bottom: q[5] }
  }
  const control = async (index, predicate) => {
    const host = orderedHosts(await root())[index]
    return nodes(host?.shadowRoots?.[0]).find(predicate)
  }
  return {
    snapshot: async () => {
      const currentRoot = await root()
      const all = nodes(currentRoot)
      const hosts = orderedHosts(currentRoot)
      const controls = await Promise.all(hosts.map(async (host) => {
        const shadow = nodes(host.shadowRoots?.[0])
        const toggle = shadow.find(node => attr(node, "class") === "toggle")
        const trigger = shadow.find(node => attr(node, "class") === "trigger")
        const panel = shadow.find(node => attr(node, "class") === "panel")
        const dock = shadow.find(node => attr(node, "class") === "dock")
        const computed = dock && await cdp.send("CSS.getComputedStyleForNode", { nodeId: dock.nodeId }).catch(() => null)
        const idle = attr(host, "data-idle") !== undefined
        return {
          enabled: attr(toggle, "aria-pressed") === "true",
          disabled: attr(toggle, "disabled") !== undefined,
          expanded: attr(trigger, "aria-expanded") === "true",
          iconTrigger: nodes(trigger).some(node => attr(node, "class") === "logo"),
          triggerText: text(trigger),
          dockButtonCount: nodes(dock).filter(node => node.nodeName === "BUTTON").length,
          dock: await bounds(dock),
          panel: await bounds(panel),
          idle,
          hidden: idle || attr(host, "data-hidden") !== undefined,
          ariaHidden: attr(host, "aria-hidden") === "true",
          inert: attr(host, "inert") !== undefined,
          dockOpacity: Number.parseFloat(computed?.computedStyle.find(property => property.name === "opacity")?.value ?? "NaN"),
        }
      }))
      const captions = all.filter(node => attr(node, "data-readomi-subtitles") !== undefined).map(host => text(nodes(host.shadowRoots?.[0]).find(node => attr(node, "class") === "translated")))
      return { controls, captions }
    },
    click: async (index, kind, value) => {
      const button = await control(index, node => kind === "preset" ? attr(node, "data-preset") === value : attr(node, "aria-label") === value)
      const box = await bounds(button)
      assert.ok(box, `player ${index} control ${value} is visible`)
      await page.mouse.click((box.left + box.right) / 2, (box.top + box.bottom) / 2)
    },
    controlBounds: async (index, label) => bounds(await control(index, node => attr(node, "aria-label") === label)),
    isAboveCaption: async (index) => {
      const label = await bounds(await control(index, node => attr(node, "class") === "size-label"))
      if (!label)
        return false
      return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute("data-readomi-video-controls") === true, { x: label.left + 2, y: (label.top + label.bottom) / 2 })
    },
  }
}

it("player controls stop translation, retain per-video scope and preserve cached captions through presets and resizing", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const settings = launched.page
  await configureService(settings, launched.extensionId, setupDocumentFor(service.origin))
  await patchFeatures({ videoSubtitles: true, videoExcludedSites: [] })
  await context.route("https://www.youtube.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }))
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto("https://www.youtube.com/watch?v=readomi-video-controls")
  const inspector = await playerInspector(page)
  const read = inspector.snapshot
  await waitFor(read, state => state.controls.length === 2 && state.controls.every(control => control.enabled) && state.captions.some(text => text.includes("【译】First video sentence.")) && state.captions.some(text => text.includes("【译】Second video sentence.")), "both video translations did not start")
  await waitFor(() => page.locator(".ytp-right-controls").evaluateAll(groups => groups.map((group) => {
    const host = group.firstElementChild
    const settings = group.querySelector("button[aria-label='Settings']")
    return host?.hasAttribute("data-readomi-video-controls") && host.nextElementSibling && (host.nextElementSibling === settings || host.nextElementSibling.contains(settings))
  })), groups => groups.length === 2 && groups.every(Boolean), "Readomi did not join the start of each YouTube right tools group")
  assert.equal(await page.locator("#first .ytp-left-controls").evaluate((left) => {
    const chrome = left.closest(".ytp-chrome-bottom")
    const native = [...left.children].reduce((total, child) => total + child.getBoundingClientRect().width, 0)
    return getComputedStyle(left).flexGrow === "1" && left.getBoundingClientRect().width > chrome.getBoundingClientRect().width / 2 && left.getBoundingClientRect().width > native + 80
  }), true, "the modern YouTube fixture leaves flexible empty space in its native left group")
  assert.equal(await page.locator(".ytp-right-controls [data-readomi-video-controls]").count(), 2, "YouTube controls precede settings, picture in picture and fullscreen in the native right group")
  assert.ok((await read()).controls.every(control => control.iconTrigger && control.triggerText === "" && control.dockButtonCount === 2), "the default dock has an icon button and translation toggle without preset text")
  assert.deepEqual(await page.evaluate(() => window.e2eTracks.map(track => track.mode)), ["hidden", "hidden"])

  await inspector.click(0, "label", "Disable video translation")
  await waitFor(read, state => !state.controls[0]?.enabled && state.controls[1]?.enabled && state.captions.length === 1, "session switch affected the other player")
  assert.equal((await read()).controls[0].expanded, false, "the translation toggle does not open subtitle presets")
  assert.equal((await storedConfig(context)).features.videoSubtitles, true, "session disable leaves the global setting enabled")
  assert.deepEqual(await page.evaluate(() => window.e2eTracks.map(track => track.mode)), ["showing", "hidden"])
  assert.equal(await page.locator("#first .ytp-caption-window-container").evaluate(node => getComputedStyle(node).visibility), "visible", "disabled translation restores native captions")

  await page.locator("#first").evaluate(player => player.classList.add("ytp-autohide"))
  await waitFor(read, state => state.controls[0]?.idle && state.controls[0]?.dockOpacity === 0 && state.controls[0]?.ariaHidden && state.controls[0]?.inert, "a mouse click's remaining focus locked the dock above YouTube's hidden controls")
  assert.equal((await read()).controls[0].hidden, true)
  await page.locator("#first").evaluate(player => player.classList.remove("ytp-autohide"))
  await waitFor(read, state => !state.controls[0]?.hidden && state.controls[0]?.dockOpacity === 1 && !state.controls[0]?.ariaHidden && !state.controls[0]?.inert, "the dock did not return with YouTube's native controls")

  await page.locator("#first .ytp-left-controls button[aria-label='Pause']").focus()
  await page.keyboard.press("Tab")
  await waitFor(() => page.evaluate(() => document.activeElement?.hasAttribute("data-readomi-video-controls")), focused => focused, "Tab did not reach a Readomi control")
  await page.locator("#first").evaluate(player => player.classList.add("ytp-autohide"))
  await waitFor(read, state => state.controls[0]?.hidden && state.controls[0]?.dockOpacity === 0 && state.controls[0]?.inert, "keyboard focus kept the dock visible after YouTube's native toolbar hid")
  assert.equal(await page.locator("#first .ytp-right-controls [data-readomi-video-controls]").count(), 1, "hidden keyboard focus keeps the native right-tools slot")
  await page.locator("#first").evaluate(player => player.classList.remove("ytp-autohide"))
  await page.locator("h1").click()

  const stoppedRequests = service.translationRequests().length
  await page.evaluate(() => {
    const track = window.e2eTracks[0]
    for (const cue of [...track.cues])
      track.removeCue(cue)
    track.addCue(new VTTCue(0, 60, "Disabled cue sentence."))
  })
  await page.waitForTimeout(650)
  assert.equal(service.translationRequests().length, stoppedRequests, "a closed video does not send new caption requests")
  await inspector.click(0, "label", "Enable video translation")
  await waitFor(read, state => state.controls[0]?.enabled && state.captions.some(text => text.includes("【译】Disabled cue sentence.")), "session re-enable did not translate the new cue")

  const presetVideo = await page.locator("#first video").boundingBox()
  await inspector.click(0, "label", "Adjust subtitle preset")
  const opened = await waitFor(read, (state) => {
    const control = state.controls[0]
    return control?.expanded && control.panel && control.dock
      && Math.abs(control.panel.right - control.dock.right) < 2 && control.panel.bottom <= control.dock.top + 1
      && control.panel.left >= presetVideo.x && control.panel.right <= presetVideo.x + presetVideo.width
      && control.panel.top >= presetVideo.y && control.panel.bottom <= presetVideo.y + presetVideo.height
  }, "the Readomi icon did not open presets right-aligned above the toolbar")
  assert.equal(opened.controls[0].enabled, true, "the Readomi icon opens presets without toggling translation")
  await page.locator("#first").evaluate(player => player.classList.add("ytp-autohide"))
  await waitFor(read, state => state.controls[0]?.expanded && state.controls[0]?.hidden && state.controls[0]?.dockOpacity === 0 && state.controls[0]?.inert, "the preset panel did not hide with YouTube's native toolbar")
  assert.equal(await page.locator("#first .ytp-right-controls [data-readomi-controls-anchor]").count(), 1, "the hidden menu preserves its native toolbar anchor")
  await page.locator("#first").evaluate(player => player.classList.remove("ytp-autohide"))
  await waitFor(read, state => state.controls[0]?.expanded && !state.controls[0]?.hidden && state.controls[0]?.dockOpacity === 1 && !state.controls[0]?.inert, "the open panel did not return with YouTube's native toolbar")
  const cachedRequests = service.translationRequests().length
  await inspector.click(0, "preset", "compact")
  await waitFor(() => storedConfig(context), config => config.features.subtitleStyle.preset === "compact" && config.features.subtitleStyle.fontSize === 16, "player preset did not persist")
  await waitFor(read, state => state.captions.some(text => text.includes("【译】Disabled cue sentence.")), "style change lost the current caption")
  await page.waitForTimeout(650)
  assert.equal(service.translationRequests().length, cachedRequests, "changing presets reuses the current translation")
  assert.equal(await inspector.isAboveCaption(0), true, "the preset panel stays above captions where they overlap")
  await inspector.click(0, "label", "Adjust subtitle preset")
  await waitFor(read, state => !state.controls[0]?.expanded && !state.controls[0]?.hidden && state.controls[0]?.dockOpacity === 1, "closing presets did not restore the native toolbar slot")
  await page.locator("#first").evaluate(player => player.classList.add("ytp-autohide"))
  await waitFor(read, state => state.controls[0]?.idle && state.controls[0]?.dockOpacity === 0, "closing presets left pointer focus locking the dock on screen")
  assert.ok((await read()).captions.some(text => text.includes("【译】Disabled cue sentence.")), "hiding the dock keeps the translated caption")
  await page.locator("#first").evaluate(player => player.classList.remove("ytp-autohide"))
  await waitFor(read, state => !state.controls[0]?.hidden && state.controls[0]?.dockOpacity === 1, "YouTube's visible controls did not wake the closed dock")
  await inspector.click(0, "label", "Adjust subtitle preset")
  await waitFor(read, state => state.controls[0]?.expanded, "preset panel did not reopen after auto-hide")
  await page.screenshot({ path: "/tmp/readomi-video-controls.png" })

  await page.locator("#first").evaluate(player => player.requestFullscreen())
  await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector("#first [data-readomi-video-controls]")))
  const fullscreen = await waitFor(read, state => state.controls[0]?.expanded && state.controls[0]?.panel, "fullscreen panel was not visible")
  const fullscreenBounds = await page.locator("#first").boundingBox()
  assert.ok(fullscreen.controls[0].panel.left >= fullscreenBounds.x && fullscreen.controls[0].panel.right <= fullscreenBounds.x + fullscreenBounds.width)
  await inspector.click(0, "label", "Increase subtitle size")
  await waitFor(() => storedConfig(context), config => config.features.subtitleStyle.fontSize === 17, "fullscreen size action did not save")
  await page.evaluate(() => document.exitFullscreen())
  await page.setViewportSize({ width: 390, height: 700 })
  const { state: narrow, videoBounds } = await waitFor(async () => ({ state: await read(), videoBounds: await page.locator("#first video").boundingBox() }), ({ state, videoBounds }) => {
    const panel = state.controls[0]?.panel
    return state.controls[0]?.expanded && panel && videoBounds
      && panel.left >= videoBounds.x && panel.right <= videoBounds.x + videoBounds.width
      && panel.top >= videoBounds.y && panel.bottom <= videoBounds.y + videoBounds.height
  }, "narrow preset panel did not settle inside the resized video")
  assert.ok(narrow.controls[0].panel.top >= videoBounds.y && narrow.controls[0].panel.bottom <= videoBounds.y + videoBounds.height, "narrow preset panel stays inside the player")
  const reset = await inspector.controlBounds(0, "Reset subtitle position")
  assert.ok(reset && reset.top >= narrow.controls[0].panel.top && reset.bottom <= narrow.controls[0].panel.bottom + 1, "the narrow panel exposes its last action without clipping")
  await inspector.click(0, "label", "Decrease subtitle size")
  await waitFor(() => storedConfig(context), config => config.features.subtitleStyle.fontSize === 16, "narrow size action did not save")
  await page.screenshot({ path: "/tmp/readomi-video-controls-mobile.png" })
  await inspector.click(0, "label", "Adjust subtitle preset")
  await page.setViewportSize({ width: 1280, height: 1000 })

  await patchFeatures({ videoSubtitles: false })
  await waitFor(read, state => state.controls.length === 2 && state.controls.every(control => !control.enabled) && state.captions.length === 0, "global disable did not reset player sessions")
  await inspector.click(0, "label", "Enable video translation")
  await waitFor(read, state => state.controls[0]?.enabled && !state.controls[1]?.enabled && state.captions.length === 1, "a default-off video could not enable its own session")
  assert.equal((await storedConfig(context)).features.videoSubtitles, false)
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=another-video")
  })
  await waitFor(read, state => state.controls.every(control => !control.enabled) && state.captions.length === 0, "navigation to another video retained the old session switch")

  await patchFeatures({ videoSubtitles: true })
  await waitFor(read, state => state.controls.every(control => control.enabled) && state.captions.length === 2, "global enable did not restore video defaults")
  await patchFeatures({ videoExcludedSites: [{ type: "domain", value: "youtube.com" }] })
  await waitFor(read, state => state.controls.length === 2 && state.controls.every(control => !control.enabled && control.disabled) && state.captions.length === 0, "dynamic domain exclusion did not stop the subdomain's videos")
  assert.deepEqual(await page.evaluate(() => window.e2eTracks.map(track => track.mode)), ["showing", "showing"])
  const excludedRequests = service.translationRequests().length
  await page.evaluate(() => {
    const track = window.e2eTracks[0]
    for (const cue of [...track.cues])
      track.removeCue(cue)
    track.addCue(new VTTCue(0, 60, "Excluded cue sentence."))
  })
  await page.waitForTimeout(650)
  assert.equal(service.translationRequests().length, excludedRequests, "an excluded site cannot issue new caption requests")
  await patchFeatures({ videoExcludedSites: [] })
  await waitFor(read, state => state.controls.every(control => control.enabled && !control.disabled) && state.captions.some(text => text.includes("【译】Excluded cue sentence.")), "removing the exclusion did not resume the current global default")
})

const genericFixture = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HTML5 video translation fixture</title>
<style>body{margin:0;background:#faf8f5;font:14px system-ui}h1{margin:20px auto;width:640px;font-size:20px}.video-js{position:relative;width:640px;height:360px;margin:20px auto;background:#252c38}video{display:block;width:100%;height:100%}.vjs-control-bar{box-sizing:border-box;position:absolute;bottom:0;left:0;width:100%;height:40px;display:flex;align-items:center;gap:8px;padding:0 12px;color:white;background:#0008}.vjs-control-bar button{background:transparent;border:0;color:inherit;font:inherit;padding:4px}.vjs-progress-control{min-width:0;flex:1;height:4px;background:#b6533e}</style>
<h1>HTML5 video translation</h1>${["first-native", "second-native"].map(id => `<div id="${id}" class="video-js"><video src="/video.wav" muted autoplay loop aria-label="${id} video"></video><div class="vjs-control-bar"><button type="button" class="vjs-play-control" aria-label="Pause">Ⅱ</button><div class="vjs-progress-control"></div><button type="button" class="vjs-fullscreen-control" aria-label="Fullscreen">⛶</button></div></div>`).join("")}
<script>window.e2eTracks=[...document.querySelectorAll('video')].map((video,index)=>{const track=video.addTextTrack('subtitles','English','en');track.mode='showing';track.addCue(new VTTCue(0,60,index===0?'Generic video sentence.':'Second native video.'));return track;});</script></html>`

it("generic HTML5 videos keep automatic subtitle translation without mounting Readomi controls", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  await patchFeatures({ videoSubtitles: true, videoExcludedSites: [] })
  // A real silent PCM resource exposes the same playing state in the page and
  // extension's isolated world, unlike redefining a getter in the page alone.
  const media = Buffer.alloc(44 + 8000 * 60, 128)
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
  await context.route("https://readomi-video-controls.test/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/video.wav") {
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
    await route.fulfill({ contentType: "text/html", body: genericFixture })
  })
  const page = await context.newPage()
  await page.setViewportSize({ width: 1000, height: 1000 })
  await page.goto("https://readomi-video-controls.test/player")
  await waitFor(() => page.locator("video").evaluateAll(videos => videos.map(video => ({ paused: video.paused, time: video.currentTime }))), states => states.length === 2 && states.every(state => !state.paused && state.time > 0), "HTML5 fixtures' real media did not start playing")
  const inspector = await playerInspector(page)
  const read = inspector.snapshot
  const bothTranslated = state => state.captions.some(text => text.includes("【译】Generic video sentence.")) && state.captions.some(text => text.includes("【译】Second native video."))
  await waitFor(read, bothTranslated, "both HTML5 translations did not start")
  assert.equal((await read()).controls.length, 0, "a recognized generic toolbar does not qualify its site for Readomi controls")
  assert.equal(await page.locator("[data-readomi-video-controls],[data-readomi-controls-anchor]").count(), 0, "generic videos mount neither controls nor toolbar anchors")
  assert.deepEqual(await page.evaluate(() => window.e2eTracks.map(track => track.mode)), ["hidden", "hidden"], "automatic translation owns both native subtitle tracks")
  const cachedRequests = service.translationRequests().length
  await page.locator("#first-native .vjs-control-bar").evaluate(row => row.style.width = "120px")
  await page.locator(".vjs-control-bar").evaluateAll(rows => rows.forEach(row => row.style.opacity = "0"))
  await page.locator("#first-native video").evaluate(video => video.pause())
  await page.waitForTimeout(650)
  assert.ok(bothTranslated(await read()), "native toolbar visibility and pausing preserve both translations")
  assert.equal(await page.locator("[data-readomi-video-controls],[data-readomi-controls-anchor]").count(), 0, "generic controls remain absent through native player changes")
  assert.equal(service.translationRequests().length, cachedRequests, "native player changes reuse translated cues")
  await patchFeatures({ videoSubtitles: false })
  await waitFor(read, state => state.captions.length === 0, "global disable did not stop generic HTML5 translations")
  assert.deepEqual(await page.evaluate(() => window.e2eTracks.map(track => track.mode)), ["showing", "showing"], "global disable restores both generic native tracks")
  assert.equal(await page.locator("[data-readomi-video-controls],[data-readomi-controls-anchor]").count(), 0, "global-off generic videos also have no Readomi UI")
})

function bilibiliFixture(search) {
  const pageName = search ? "search" : "watch"
  const playerClass = search ? "video-preview" : "bpx-player-container"
  const cue = `Bilibili ${pageName} subtitle sentence.`
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Bilibili ${pageName} fixture</title>
<style>body{margin:0;background:#faf8f5;font:14px system-ui}h1{margin:20px auto;width:640px;font-size:20px}.video-preview,.bpx-player-container{position:relative;width:640px;height:360px;margin:20px auto;background:#252c38}.video-preview{width:320px;height:180px}video{display:block;width:100%;height:100%}</style>
<h1>Bilibili ${pageName}</h1><div class="${playerClass}" id="no-track"><video ${search ? "" : "controls"} muted autoplay loop aria-label="No subtitle video"></video></div><div class="${playerClass}" id="with-track"><video controls aria-label="Native subtitle video"></video></div>
<script>const video=document.querySelector('#with-track video');const track=video.addTextTrack('subtitles','English','en');track.mode='showing';track.addCue(new VTTCue(0,60,${JSON.stringify(cue)}));window.e2eTrack=track;</script></html>`
}

it("Bilibili search previews and main players omit controls with or without subtitle tracks", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  await patchFeatures({ videoSubtitles: true, videoExcludedSites: [] })
  await context.route(/^https:\/\/(?:search|www)\.bilibili\.com\//, route => route.fulfill({
    contentType: "text/html",
    body: bilibiliFixture(new URL(route.request().url()).hostname === "search.bilibili.com"),
  }))
  const page = await context.newPage()
  await page.setViewportSize({ width: 1000, height: 1000 })
  for (const [pageName, url] of [["search", "https://search.bilibili.com/all?keyword=readomi"], ["watch", "https://www.bilibili.com/video/BV1ReadomiFixture/"]]) {
    await page.goto(url)
    const read = (await playerInspector(page)).snapshot
    const expectedTranslation = `【译】${`Bilibili ${pageName} subtitle sentence.`.slice(0, 24).trimEnd()}`
    await waitFor(read, state => state.captions.some(text => text.includes(expectedTranslation)), `Bilibili ${pageName} native subtitles did not translate`)
    assert.deepEqual(await page.locator("video").evaluateAll(videos => videos.map(video => [...video.textTracks].map(track => track.kind))), [[], ["subtitles"]], `Bilibili ${pageName} exercises both trackless and subtitled videos`)
    assert.equal(await page.locator("[data-readomi-video-controls],[data-readomi-controls-anchor]").count(), 0, `Bilibili ${pageName} never mounts Readomi controls, including on a player with native subtitle tracks`)
    assert.equal(await page.evaluate(() => window.e2eTrack.mode), "hidden", "Bilibili keeps automatic HTML5 translation despite having no Readomi controls")
    await page.screenshot({ path: `/tmp/readomi-bilibili-${pageName}-no-controls.png` })
    await patchFeatures({ videoSubtitles: false })
    await waitFor(read, state => state.captions.length === 0, `Bilibili ${pageName} kept translating after global disable`)
    assert.equal(await page.evaluate(() => window.e2eTrack.mode), "showing", "global disable restores Bilibili's native track")
    assert.equal(await page.locator("[data-readomi-video-controls],[data-readomi-controls-anchor]").count(), 0, `Bilibili ${pageName} also omits Readomi UI with translation globally disabled`)
    await patchFeatures({ videoSubtitles: true })
  }
})
