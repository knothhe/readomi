/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { chooseDisplayMode, configureService, launchBrowser, pressTranslateShortcut, reportFailure, storedConfig } from "./browser.mjs"
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
    context = undefined
    service = undefined
  }
})

async function waitFor(read, predicate, description) {
  const deadline = Date.now() + 15_000
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value))
      return value
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  throw new Error(`${description}: ${JSON.stringify(value)}`)
}

async function chooseLanguage(page, label, value) {
  const trigger = page.getByRole("button", { name: label, exact: true })
  await trigger.click()
  await page.locator(`[role="option"][data-value="${value}"]`).click()
  await waitFor(() => trigger.getAttribute("data-value"), selected => selected === value, `${label} updates to ${value}`)
}

async function openArticle(suffix) {
  const page = await context.newPage()
  await page.goto(`${service.origin}/language-rules?case=${suffix}`)
  return page
}

async function translateArticle(suffix, expectations) {
  const mode = (await storedConfig(context)).translate.mode
  const page = await openArticle(suffix)
  await pressTranslateShortcut(page)
  for (const [id, text] of Object.entries(expectations)) {
    // Translation-only mode uses a display:contents wrapper rather than the
    // bilingual block-content class. Check the rendered paragraph in either mode.
    await page.waitForFunction(({ id, text }) => {
      const paragraph = document.getElementById(id)
      return paragraph?.textContent.includes(text) && paragraph.getBoundingClientRect().height > 0 && !paragraph.querySelector(".readomi-spinner")
    }, { id, text }, { timeout: 20_000 })
    if (mode === "translationOnly")
      assert.equal((await page.locator(`#${id}`).textContent()).trim(), text, "translation-only paragraphs contain only their routed translation")
  }
  await page.waitForFunction(() => document.querySelectorAll(".readomi-spinner").length === 0)
  assert.equal((await page.locator("body").textContent()).includes("[[readomi:"), false, "protocol headers never reach the page")
  return page
}

async function assertPreserved(page, id, expected) {
  const paragraph = page.locator(`#${id}`)
  assert.equal(await paragraph.isVisible(), true, "the preserved source remains visible")
  assert.equal(await paragraph.textContent(), expected, "the preserved source appears exactly once")
  assert.equal(await paragraph.locator(".readomi-translated-content-wrapper, .readomi-translated-block-content, [data-readomi-inline-preview]").count(), 0, "preservation creates no duplicate or empty translation container")
}

// Subtitles intentionally use the closed production shadow root. CDP reads its
// rendered nodes without changing the runtime to expose a testing-only API.
async function subtitleReader(page) {
  const cdp = await context.newCDPSession(page)
  const find = (node, predicate) => predicate(node) ? node : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(child => find(child, predicate)).find(Boolean)
  const attribute = (node, name) => {
    const index = node?.attributes?.indexOf(name) ?? -1
    return index >= 0 ? node.attributes[index + 1] : undefined
  }
  const text = node => node ? node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join("") : ""
  return async () => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    const host = find(root, node => attribute(node, "data-readomi-subtitles") !== undefined)
    const shadow = host?.shadowRoots?.[0]
    if (!shadow)
      return {}
    const original = find(shadow, node => attribute(node, "class") === "original")
    const translated = find(shadow, node => attribute(node, "class") === "translated")
    const box = find(shadow, node => attribute(node, "class")?.split(" ").includes("box"))
    return {
      original: text(original),
      translated: text(translated),
      originalHidden: attribute(original, "hidden") !== undefined,
      translationHidden: attribute(translated, "hidden") !== undefined,
      boxHidden: attribute(box, "class")?.split(" ").includes("empty"),
    }
  }
}

async function captionPage(suffix, caption) {
  const page = await openArticle(suffix)
  await page.evaluate((caption) => {
    const player = document.createElement("div")
    player.className = "html5-video-player"
    const video = document.createElement("video")
    video.style.cssText = "display:block;width:640px;height:360px"
    const captions = document.createElement("div")
    captions.className = "ytp-caption-window-container"
    const line = document.createElement("span")
    line.className = "ytp-caption-segment"
    line.textContent = caption
    captions.append(line)
    player.append(video, captions)
    document.body.prepend(player)
  }, caption)
  await page.locator("[data-readomi-subtitles]").waitFor()
  return page
}

it("shares automatic language rules across settings and popup, isolates cached policies and preserves page, hover and subtitle originals", async () => {
  service = await startFakeService({ streaming: true, languageRules: true })
  const launched = await launchBrowser()
  context = launched.context
  const { page: settings, extensionId } = launched
  await configureService(settings, extensionId, setupDocumentFor(service.origin))
  await context.serviceWorkers()[0].evaluate(async () => {
    const { config } = await chrome.storage.local.get("config")
    config.translate.enableAIContentAware = false
    config.features.hoverTranslation = true
    config.features.hoverStream = true
    config.features.videoSubtitles = true
    await chrome.storage.local.set({ config })
  })
  await settings.goto(`chrome-extension://${extensionId}/options.html#language`)
  await settings.getByRole("heading", { name: "Translation languages", exact: true }).waitFor()
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  assert.equal((await storedConfig(context)).language.targetCode, "cmn")
  assert.equal((await storedConfig(context)).language.secondaryCode, "original")
  assert.equal(await popup.getByRole("button", { name: "Primary language", exact: true }).getAttribute("data-value"), "cmn")
  assert.equal(await popup.getByRole("button", { name: "Second language", exact: true }).getAttribute("data-value"), "original")

  const { design, world, curious } = LANGUAGE_RULES_FIXTURES
  const preservedDefault = await translateArticle("default-preserved", { "en-before": design.zh, "en-after": curious.zh })
  await assertPreserved(preservedDefault, "zh-middle", world.zh)
  await preservedDefault.close()
  await chooseLanguage(settings, "Second language", "eng")
  await waitFor(() => popup.getByRole("button", { name: "Second language", exact: true }).getAttribute("data-value"), value => value === "eng", "the explicit secondary language is saved")
  const defaultExpectations = { "en-before": design.zh, "zh-middle": world.en, "en-after": curious.zh }
  const first = await translateArticle("default", defaultExpectations)
  const afterFirst = service.translationRequests().length
  await first.close()
  const cached = await translateArticle("default", defaultExpectations)
  assert.equal(service.translationRequests().length, afterFirst, "the same language policy reuses cached results")
  await cached.close()

  const caption = await captionPage("default-caption", world.zh)
  const subtitle = await subtitleReader(caption)
  await waitFor(subtitle, state => state.original === world.zh && state.translated === world.en, "Chinese captions use the English secondary language")
  await caption.close()

  // Both explicit preservation and selecting the same language keep each
  // paragraph in place, including a preserved segment in the middle of a batch.
  for (const second of ["original", "cmn"]) {
    await chooseLanguage(settings, "Second language", second)
    await waitFor(() => popup.getByRole("button", { name: "Second language", exact: true }).getAttribute("data-value"), value => value === second, "settings immediately update the popup")
    await waitFor(() => storedConfig(context), config => config.language.secondaryCode === second, "the secondary language is saved")
    for (const mode of ["bilingual", "translationOnly"]) {
      await chooseDisplayMode(popup, mode)
      const before = service.translationRequests().length
      const page = await translateArticle(`${second}-${mode}`, { "en-before": design.zh, "en-after": curious.zh })
      await assertPreserved(page, "zh-middle", world.zh)
      if (second === "original" && mode === "bilingual") {
        assert.equal(service.translationRequests().length, before, "returning to the original policy reuses its preserved result, not the cached Chinese-to-English translation")
        assert.ok(service.translationRequests().some((messages) => {
          const system = messages.filter(message => message.role === "system").map(message => message.content).join("\n")
          const user = messages.at(-1).content
          return system.includes("Secondary language: keep the original.") && user.includes("%%") && user.includes(design.en) && user.includes(world.zh) && user.includes(curious.en)
        }), "one mixed batch includes the preserved middle segment without shifting the following translation")
      }
      await page.close()

      const hover = await openArticle(`hover-${second}-${mode}`)
      const hoverText = `${world.zh} [hover ${second} ${mode}]`
      await hover.locator("#zh-middle").evaluate((node, text) => node.textContent = text, hoverText)
      const beforeHover = service.translationRequests().length
      await hover.bringToFront()
      await hover.locator("#zh-middle").hover()
      await hover.keyboard.press("Alt")
      await waitFor(() => service.translationRequests().length, count => count > beforeHover, "hover reaches the model with its language policy")
      await hover.locator(".readomi-spinner").first().waitFor({ state: "detached" })
      await assertPreserved(hover, "zh-middle", hoverText)
      assert.equal(await hover.locator("[data-readomi-inline-preview]").count(), 0, "a preserved streamed header leaves no inline preview")
      await hover.close()

      await chooseDisplayMode(popup, mode, true)
      const caption = await captionPage(`caption-${second}-${mode}`, world.zh)
      const readSubtitle = await subtitleReader(caption)
      const preserved = await waitFor(readSubtitle, state => state.original === world.zh && state.translated === "" && state.translationHidden && !state.originalHidden && !state.boxHidden, "preserved subtitles show one original in either mode")
      assert.equal(preserved.original, world.zh)
      await caption.close()
    }
  }

  // Change the primary language from the popup and verify the rule's condition
  // follows that choice in the already-open settings page.
  await chooseLanguage(popup, "Primary language", "eng")
  await chooseLanguage(popup, "Second language", "original")
  await waitFor(() => settings.getByRole("button", { name: "Primary language", exact: true }).getAttribute("data-value"), value => value === "eng", "popup updates the settings primary language")
  await chooseDisplayMode(popup, "bilingual")
  const changedPrimary = await translateArticle("english-primary", { "zh-middle": world.en })
  await assertPreserved(changedPrimary, "en-before", design.en)
  await assertPreserved(changedPrimary, "en-after", curious.en)
  const final = await storedConfig(context)
  assert.equal(final.language.targetCode, "eng")
  assert.equal(final.language.secondaryCode, "original")
  assert.equal(final.language.sourceCode, "auto")
  await changedPrimary.close()
})
