/* global chrome -- browser API callbacks run in the extension worker or popup. */
import assert from "node:assert/strict"
import process from "node:process"
import { afterEach, it } from "node:test"
import { configureService, extensionPath, launchBrowser, reportFailure, storedConfig } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

const LABEL = "Exclude this site from video translation"
const HOST = "video.popup-video.test"
const HOST_URL = `https://${HOST}/watch/one`
const CHILD_URL = `https://sub.${HOST}/watch/child`
const DOMAIN = { type: "domain", value: HOST }
const RETAINED = [{ type: "domain", value: "retained.example" }, { type: "pattern", value: "*://elsewhere.test/watch/*" }]
let context
let service
let previousAttachToOther
const popupProofs = new Set()

afterEach(async (test) => {
  try {
    await reportFailure(test, context)
  }
  finally {
    await context?.close()
    await service?.close()
    context = service = undefined
    popupProofs.clear()
    if (previousAttachToOther === undefined)
      delete process.env.PW_CHROMIUM_ATTACH_TO_OTHER
    else
      process.env.PW_CHROMIUM_ATTACH_TO_OTHER = previousAttachToOther
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

async function writeFeatures(patch) {
  await context.serviceWorkers()[0].evaluate(async (patch) => {
    const { config } = await chrome.storage.local.get("config")
    Object.assign(config.features, patch)
    await chrome.storage.local.set({ config })
  }, patch)
}

async function prepare() {
  // Playwright 1.63 attaches Chromium's extension popup targets as Pages with
  // this flag. Keep it local to this test process; ordinary tabs remain tabs.
  previousAttachToOther = process.env.PW_CHROMIUM_ATTACH_TO_OTHER
  process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1"
  service = await startFakeService()
  const launched = await launchBrowser({ extension: process.env.E2E_EXTENSION_PATH || extensionPath })
  context = launched.context
  const popupUrl = `chrome-extension://${launched.extensionId}/popup.html`
  await context.addInitScript((popupUrl) => {
    if (location.href !== popupUrl)
      return
    window.e2eActiveTabQueries = []
    const original = chrome.tabs.query.bind(chrome.tabs)
    const record = (query, tabs) => {
      if (query.active && query.currentWindow)
        window.e2eActiveTabQueries.push(tabs.map(({ id, url }) => ({ id, url })))
      return tabs
    }
    // Observe the real API result without replacing the selected tab or URL.
    chrome.tabs.query = (query, callback) => callback
      ? original(query, tabs => callback(record(query, tabs)))
      : original(query).then(tabs => record(query, tabs))
  }, popupUrl)
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  await writeFeatures({ videoSubtitles: true, hoverTranslation: true, videoExcludedSites: RETAINED })
  await context.route(/^https:\/\/(?:video|sub\.video)\.popup-video\.test\//, (route) => {
    const child = new URL(route.request().url()).hostname.startsWith("sub.")
    const cue = child ? "Popup child sentence." : "Popup main sentence."
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Popup video exclusion host</title><style>body{margin:24px;font:16px system-ui}video{display:block;width:640px;height:360px;background:#302b29}</style><h1>Video exclusion host</h1><video controls></video><script>const video=document.querySelector('video');const track=video.addTextTrack('subtitles','English','en');track.mode='showing';track.addCue(new VTTCue(0,60,${JSON.stringify(cue)}));window.e2eTrack=track;</script></html>`,
    })
  })
  const host = await context.newPage()
  await host.goto(HOST_URL)
  return { ...launched, host, popupUrl }
}

async function openPopup(host, popupUrl, test) {
  const worker = context.serviceWorkers()[0]
  const target = await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)
    if (!tab?.id)
      throw new Error(`host tab not found: ${url}`)
    await chrome.tabs.update(tab.id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
    return { id: tab.id, url: tab.url, windowId: tab.windowId, activeId: active?.id, activeUrl: active?.url }
  }, host.url())
  assert.equal(target.activeId, target.id)
  assert.equal(target.activeUrl, target.url)
  let popup = null
  let outcome = "macOS headless Chromium crashes with SIGSEGV when opening an action popup"
  // This installed macOS headless Chromium crashes inside openPopup rather
  // than rejecting it. Do not repeat that native path on this platform.
  if (process.platform !== "darwin") {
    const realPage = context.waitForEvent("page", { timeout: 4000 }).catch(() => null)
    outcome = await worker.evaluate(async (windowId) => {
      try {
        await chrome.action.openPopup({ windowId })
        return null
      }
      catch (error) {
        return String(error)
      }
    }, target.windowId)
    popup = await realPage
  }
  let mode = "chrome.action.openPopup"
  if (!popup || outcome) {
    if (popup)
      await popup.close()
    // A popup target unsupported by the driver must not remain beside the
    // fallback. Close only this extension's popup, never the host tab.
    const cdp = await context.newCDPSession(host)
    const { targetInfos } = await cdp.send("Target.getTargets")
    for (const info of targetInfos.filter(info => info.url === popupUrl))
      await cdp.send("Target.closeTarget", { targetId: info.targetId })
    await cdp.detach()
    const nextPage = context.waitForEvent("page", { timeout: 5000 })
    await worker.evaluate(async ({ windowId, url }) => chrome.tabs.create({ windowId, url, active: false }), { windowId: target.windowId, url: popupUrl })
    popup = await nextPage
    mode = "inactive popup.html tab"
    if (!popupProofs.has(mode)) {
      popupProofs.add(mode)
      test.diagnostic(`popup fallback (${outcome || "no controllable action popup target"}); toolbar opening/user gesture is not covered by this fallback`)
    }
  }
  await popup.waitForURL(popupUrl)
  await popup.getByRole("switch", { name: /Exclude this site from video translation|此网站不翻译视频/, exact: true }).waitFor()
  await waitFor(() => popup.evaluate(() => window.e2eActiveTabQueries), queries => queries?.some(tabs => tabs.some(tab => tab.id === target.id && tab.url === target.url)), "popup bootstrap did not query the actual active host tab")
  const proof = `${mode} queried host tab ${target.id}: ${target.url}`
  if (!popupProofs.has(proof)) {
    popupProofs.add(proof)
    test.diagnostic(proof)
  }
  return popup
}

async function closePopup(popup) {
  if (!popup.isClosed())
    await popup.close()
}

async function captionReader(page) {
  const cdp = await context.newCDPSession(page)
  const attr = (node, name) => {
    const index = node.attributes?.indexOf(name) ?? -1
    return index < 0 ? undefined : node.attributes[index + 1]
  }
  const nodes = node => [node, ...(node.children ?? []).flatMap(nodes), ...(node.shadowRoots ?? []).flatMap(nodes)]
  const text = node => !node ? "" : node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join("")
  return async () => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    return nodes(root).filter(node => attr(node, "data-readomi-subtitles") !== undefined).map(host => text(nodes(host).find(node => attr(node, "class") === "translated")))
  }
}

function ruleSection(settings) {
  return settings.locator("#features").getByRole("region", { name: "Sites without video translation", exact: true })
}

async function removeDomain(settings) {
  const section = ruleSection(settings)
  await section.locator("li").filter({ has: settings.getByText(HOST, { exact: true }) }).getByRole("button", { name: "Remove rule", exact: true }).click()
}

async function expectSwitch(popup, checked, disabled = false, label = LABEL) {
  const toggle = popup.getByRole("switch", { name: label, exact: true })
  await waitFor(async () => ({ checked: await toggle.getAttribute("aria-checked"), disabled: await toggle.isDisabled() }), state => state.checked === String(checked) && state.disabled === disabled, "popup exclusion switch did not settle")
  return toggle
}

async function expectCompactExclusion(popup, toggle, description = "Includes subdomains; only affects video translation.", manageLabel = "Manage rules") {
  const information = await toggle.evaluate((control) => {
    const descriptions = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map(id => document.getElementById(id)).filter(Boolean)
    const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`)
    return {
      labelTitle: label?.title ?? "",
      description: descriptions.map(node => node.textContent?.trim() ?? "").join(" "),
      hiddenDescriptions: descriptions.every((node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return (rect.width <= 1 && rect.height <= 1) || style.display === "none" || style.visibility === "hidden"
      }),
    }
  })
  assert.ok(information.labelTitle.includes(HOST), "the compact label's tooltip retains the complete hostname")
  assert.ok(information.description.includes(description), "the switch's referenced ARIA description retains the exclusion's scope")
  assert.equal(information.hiddenDescriptions, true, "ordinary exclusion metadata does not occupy a visible row")
  assert.equal(await popup.getByRole("button", { name: manageLabel, exact: true }).count(), 0, "ordinary states do not expose a separate rule-management action")
}

it("popup exclusion reads the actual active host, restores subtitles and synchronizes exact domain rules with settings", async (test) => {
  const { host, page: settings, extensionId, popupUrl } = await prepare()
  await settings.goto(`chrome-extension://${extensionId}/options.html#features`)
  await settings.locator("summary").filter({ hasText: "More options" }).click()
  await ruleSection(settings).getByRole("heading", { name: "Sites without video translation", exact: true }).waitFor()
  const child = await context.newPage()
  await child.goto(CHILD_URL)
  const readHost = await captionReader(host)
  const readChild = await captionReader(child)
  const translated = async () => (await readHost()).some(text => text.includes("【译】Popup main sentence.")) && (await readChild()).some(text => text.includes("【译】Popup child sentence."))
  await waitFor(translated, Boolean, "the host and its subdomain did not translate before exclusion")
  const original = await storedConfig(context)
  const expected = rules => ({ ...original, features: { ...original.features, videoExcludedSites: rules } })
  let popup = await openPopup(host, popupUrl, test)
  let toggle = await expectSwitch(popup, false)
  await expectCompactExclusion(popup, toggle)
  assert.equal(await popup.getByRole("switch", { name: "Video subtitle translation", exact: true }).getAttribute("aria-checked"), "true")
  // Hold the real local storage operation, then release it; this exposes the
  // saving state without faking persistence or changing the target hostname.
  await popup.evaluate(() => {
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local)
    let release
    const gate = new Promise(resolve => release = resolve)
    window.e2eReleaseSave = release
    window.e2eSiteWrites = 0
    chrome.storage.local.set = async (items) => {
      if (items.config) {
        window.e2eSiteWrites++
        await gate
      }
      return originalSet(items)
    }
  })
  await toggle.click()
  await popup.getByText("Saving…", { exact: true }).waitFor()
  assert.equal(await toggle.isDisabled(), true)
  assert.equal(await toggle.getAttribute("aria-checked"), "false", "saving retains the last persisted switch state")
  await toggle.evaluate(button => button.click())
  assert.deepEqual(await storedConfig(context), original, "pending/repeated clicks cannot overwrite the saved config")
  await waitFor(() => popup.evaluate(() => window.e2eSiteWrites), count => count === 1, "the popup did not reach its real storage write")
  await popup.evaluate(() => window.e2eReleaseSave())
  await waitFor(() => storedConfig(context), config => JSON.stringify(config.features.videoExcludedSites) === JSON.stringify([...RETAINED, DOMAIN]), "popup did not append its active host domain")
  await expectSwitch(popup, true)
  await expectCompactExclusion(popup, toggle)
  assert.deepEqual(await storedConfig(context), expected([...RETAINED, DOMAIN]), "site exclusion preserves the global toggle, provider, language, appearance and unrelated rules")
  await waitFor(async () => [...await readHost(), ...await readChild()], captions => captions.length === 0, "exclusion did not stop the host and its subdomain")
  assert.equal(await host.evaluate(() => window.e2eTrack.mode), "showing")
  assert.equal(await child.evaluate(() => window.e2eTrack.mode), "showing")
  await closePopup(popup)
  popup = await openPopup(host, popupUrl, test)
  toggle = await expectSwitch(popup, true)
  await expectCompactExclusion(popup, toggle)
  assert.deepEqual((await storedConfig(context)).features.videoExcludedSites, [...RETAINED, DOMAIN], "reopening the popup does not duplicate its domain")
  await toggle.click()
  await expectSwitch(popup, false)
  await waitFor(() => storedConfig(context), config => JSON.stringify(config.features.videoExcludedSites) === JSON.stringify(RETAINED), "popup off did not remove only its exact host domain")
  assert.deepEqual(await storedConfig(context), original)
  await waitFor(translated, Boolean, "popup off did not restore automatic subtitles")
  assert.equal(await host.evaluate(() => window.e2eTrack.mode), "hidden")
  await toggle.click()
  await expectSwitch(popup, true)
  await ruleSection(settings).getByText(HOST, { exact: true }).waitFor()
  const openedSettings = context.waitForEvent("page")
  await popup.getByRole("button", { name: "Settings", exact: true }).click()
  const managedSettings = await openedSettings
  await managedSettings.getByRole("link", { name: "Video subtitles", exact: true }).click()
  await managedSettings.waitForURL(`chrome-extension://${extensionId}/options.html#features`)
  await managedSettings.locator("summary").filter({ hasText: "More options" }).click()
  await ruleSection(managedSettings).getByText(HOST, { exact: true }).waitFor()
  await removeDomain(managedSettings)
  await waitFor(() => storedConfig(context), config => JSON.stringify(config.features.videoExcludedSites) === JSON.stringify(RETAINED), "settings deletion did not remove the popup rule")
  await waitFor(translated, Boolean, "settings deletion did not restore host subtitles")
  await closePopup(popup)
  popup = await openPopup(host, popupUrl, test)
  await expectSwitch(popup, false)
  await closePopup(popup)
  await ruleSection(managedSettings).getByRole("textbox", { name: "Site rule", exact: true }).fill(HOST)
  await ruleSection(managedSettings).getByRole("button", { name: "Add site", exact: true }).click()
  await waitFor(() => storedConfig(context), config => JSON.stringify(config.features.videoExcludedSites) === JSON.stringify([...RETAINED, DOMAIN]), "settings could not add the current host")
  popup = await openPopup(host, popupUrl, test)
  toggle = await expectSwitch(popup, true)
  await toggle.click()
  await expectSwitch(popup, false)
  await waitFor(() => ruleSection(managedSettings).getByText(HOST, { exact: true }).count(), count => count === 0, "settings did not synchronize the popup's removal")
  assert.deepEqual(await storedConfig(context), original)
  await closePopup(popup)
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.ui.language = "zh-CN"
    await chrome.storage.local.set({ config })
  })
  popup = await openPopup(host, popupUrl, test)
  toggle = await expectSwitch(popup, false, false, "此网站不翻译视频")
  await expectCompactExclusion(popup, toggle, "含子域名，仅影响视频翻译。", "管理规则")
  assert.equal((await popup.locator("#root").boundingBox()).width, 320)
  await popup.locator("#root").screenshot({ path: "/tmp/readomi-popup-video-exclusion-compact.png" })
  await toggle.click()
  await expectSwitch(popup, true, false, "此网站不翻译视频")
  await expectCompactExclusion(popup, toggle, "含子域名，仅影响视频翻译。", "管理规则")
  await popup.locator("#root").screenshot({ path: "/tmp/readomi-popup-video-exclusion-compact-excluded.png" })
})

it("the popup cannot remove wider domain, wildcard or regex exclusions and disables non-web pages", async (test) => {
  const { host, popupUrl, extensionId } = await prepare()
  const managedRules = [
    { type: "domain", value: "popup-video.test" },
    { type: "pattern", value: "*://*.popup-video.test/watch/*" },
    { type: "regex", value: "^https://video\\.popup-video\\.test/watch/" },
  ]
  for (const rule of managedRules) {
    await writeFeatures({ videoExcludedSites: [...RETAINED, rule] })
    const original = await storedConfig(context)
    const popup = await openPopup(host, popupUrl, test)
    const toggle = await expectSwitch(popup, true, true)
    const managedHint = popup.locator("p").filter({ hasText: "Managed by another rule. Adjust it in settings." })
    await managedHint.waitFor()
    assert.ok((await managedHint.boundingBox()).height > 1, "managed exclusions retain visible status feedback")
    assert.equal(await popup.getByRole("button", { name: "Manage rules", exact: true }).isVisible(), true, "managed exclusions retain their visible settings action")
    await toggle.evaluate(button => button.click())
    assert.deepEqual(await storedConfig(context), original, `${rule.type} matching cannot be removed by the current-host switch`)
    if (rule.type === "regex") {
      const nextSettings = context.waitForEvent("page")
      await popup.getByRole("button", { name: "Manage rules", exact: true }).click()
      const settings = await nextSettings
      await settings.waitForURL(`chrome-extension://${extensionId}/options.html#features`)
      await settings.locator("summary").filter({ hasText: "More options" }).click()
      await ruleSection(settings).getByText(rule.value, { exact: true }).waitFor()
    }
    await closePopup(popup)
  }
  await writeFeatures({ videoExcludedSites: [...RETAINED, DOMAIN, managedRules[2]] })
  const combined = await storedConfig(context)
  let popup = await openPopup(host, popupUrl, test)
  const managedToggle = await expectSwitch(popup, true, true)
  await managedToggle.evaluate(button => button.click())
  assert.deepEqual(await storedConfig(context), combined, "an exact host rule cannot be removed while another matching rule still manages the site")
  await closePopup(popup)
  await host.goto("about:blank")
  const beforeUnavailable = await storedConfig(context)
  popup = await openPopup(host, popupUrl, test)
  const unavailable = await expectSwitch(popup, false, true)
  const unavailableHint = popup.getByText("Unavailable on this page", { exact: true })
  await unavailableHint.waitFor()
  assert.ok((await unavailableHint.boundingBox()).height > 1, "unsupported pages retain visible status feedback")
  await unavailable.evaluate(button => button.click())
  assert.deepEqual(await storedConfig(context), beforeUnavailable, "a non-http(s) page cannot add or remove video domain rules")
})
