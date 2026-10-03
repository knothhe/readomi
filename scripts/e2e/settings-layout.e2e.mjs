import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
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

async function screenshot(page, name) {
  if (!process.env.SETTINGS_ARTIFACTS)
    return
  await mkdir(process.env.SETTINGS_ARTIFACTS, { recursive: true })
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))))
  await page.screenshot({ path: join(process.env.SETTINGS_ARTIFACTS, `${name}.png`), fullPage: true })
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    return [...document.querySelectorAll("main section:not([hidden]) input, main section:not([hidden]) textarea, main section:not([hidden]) button, .settings-select-menu")]
      .filter(element => element.getClientRects().length)
      .map(element => ({ label: element.getAttribute("aria-label") ?? element.id ?? element.tagName, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }))
      .filter(rect => rect.left < -1 || rect.right > viewport + 1)
  })
  assert.deepEqual(overflow, [], "controls fit the viewport")
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "page has no horizontal overflow")
}

it("uses large desktop widths and restores shortcut defaults through the recording buttons", async () => {
  service = await startFakeService()
  const launched = await launchBrowser({ deviceScaleFactor: 2 })
  context = launched.context
  const { page, extensionId } = launched
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  for (const width of [1920, 2504, 2560, 3840]) {
    await page.setViewportSize({ width, height: width === 2504 ? 1302 : 1440 })
    for (const section of ["service", "reading", "features", "quality", "shortcut", "appearance", "backup"]) {
      await page.locator(`nav a[href='#${section}']`).click()
      await noOverflow(page)
      const layout = await page.evaluate(() => {
        const shell = document.querySelector(".options-shell").getBoundingClientRect()
        const sidebar = document.querySelector(".options-sidebar").getBoundingClientRect()
        const activeSection = document.querySelector(".options-main > div:not([hidden]) > .settings-section")
        const section = activeSection.getBoundingClientRect()
        const form = activeSection.querySelector(".settings-shortcuts, .settings-backup-content")
        return { shellLeft: shell.left, shellWidth: shell.width, sidebarLeft: sidebar.left, sectionWidth: section.width, formWidth: form?.getBoundingClientRect().width, viewport: innerWidth, dpr: devicePixelRatio }
      })
      assert.equal(layout.shellLeft, 0)
      assert.equal(layout.sidebarLeft, 0, "navigation stays at the left viewport edge")
      assert.equal(layout.shellWidth, layout.viewport, "the shell uses the available screen width")
      assert.equal(layout.dpr, 2)
      assert.ok(layout.sectionWidth <= 2600, "extremely wide workspaces keep a useful content width")
      if (section === "quality")
        assert.ok(layout.sectionWidth <= 1200, "prompt editing keeps a readable form width")
      if (layout.formWidth)
        assert.ok(layout.formWidth <= 1200, "single-column settings retain a useful form width")
      if (width === 2504) {
        await screenshot(page, `wide-${section}`)
        if (section === "quality") {
          const quality = page.locator("#quality")
          await quality.getByRole("button", { name: "Edit", exact: true }).click()
          await noOverflow(page)
          await screenshot(page, "wide-prompt-editing")
          await quality.getByRole("button", { name: "Cancel", exact: true }).click()
        }
      }
    }
  }
  await page.setViewportSize({ width: 2504, height: 1302 })
  await page.locator("nav a[href='#shortcut']").click()
  const pageKey = page.getByRole("button", { name: "Translate this page / Show original", exact: true })
  const modeKey = page.getByRole("button", { name: "Switch bilingual / translation only", exact: true })
  const subtitlesKey = page.getByRole("button", { name: "Toggle video subtitles", exact: true })
  const hover = page.getByRole("combobox", { name: "Hover translation trigger", exact: true })
  await hover.click()
  await page.getByRole("option", { name: "Control", exact: true }).click()
  for (const [button, shortcut] of [[pageKey, "Alt+P"], [modeKey, "Alt+E"], [subtitlesKey, "Alt+V"]]) {
    await button.click()
    await page.keyboard.press(shortcut)
  }
  assert.equal((await storedConfig(context)).features.modeShortcut, "Alt+E")
  assert.equal(await pageKey.locator("kbd").count(), 2, "the shortcut is rendered as individual key buttons")
  await modeKey.click()
  assert.equal(await modeKey.getAttribute("data-recording"), "true")
  await screenshot(page, "wide-shortcut-recording")
  await page.getByRole("button", { name: "Restore defaults", exact: true }).click()
  const defaults = await storedConfig(context)
  assert.equal(defaults.translate.page.shortcut, "Alt+E")
  assert.equal(defaults.features.modeShortcut, "")
  assert.equal(defaults.features.subtitlesShortcut, "")
  assert.equal(defaults.features.hoverHotkey, "control", "restoring shortcuts preserves the hover trigger")
  assert.equal(await modeKey.getAttribute("data-recording"), "false")
  await screenshot(page, "wide-shortcut-restored")
  await page.reload()
  await pageKey.waitFor()
  assert.match(await pageKey.textContent(), /E/)
  assert.equal(await modeKey.getAttribute("data-shortcut"), "")
  assert.equal(await subtitlesKey.getAttribute("data-shortcut"), "", "restored shortcut values persist after reload")
  await modeKey.click()
  await page.evaluate(() => {
    window.location.hash = "appearance"
  })
  await page.getByRole("heading", { name: "Appearance", exact: true }).waitFor()
  await page.keyboard.press("Alt+K")
  assert.equal((await storedConfig(context)).features.modeShortcut, "", "hidden recorders leave keys on another settings page alone")
  await page.goBack()
  await page.getByRole("heading", { name: "Shortcut", exact: true }).waitFor()
  assert.equal(await modeKey.getAttribute("data-recording"), "false", "history navigation cancels recording")
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
  await screenshot(page, "mobile-shortcut-restored")
})

it("keeps settings readable across sizes, preserves prompt contents and drafts, and supports refined controls", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await page.setViewportSize({ width: 1440, height: 960 })
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.locator("nav a[href='#appearance']").click()
  const language = page.getByRole("combobox", { name: "Interface language", exact: true })
  await language.click()
  await page.getByRole("option").filter({ hasText: "简体中文" }).click()
  await page.getByRole("heading", { name: "外观", exact: true }).waitFor()
  for (const section of ["service", "reading", "features", "quality", "shortcut", "appearance", "backup"]) {
    await page.locator(`nav a[href='#${section}']`).click()
    await noOverflow(page)
    await screenshot(page, `desktop-${section}`)
  }

  await page.locator("nav a[href='#quality']").click()
  const quality = page.locator("#quality")
  await quality.getByRole("button", { name: "修改", exact: true }).click()
  const system = quality.getByLabel("系统提示词", { exact: true })
  const template = quality.getByLabel("提示词模板", { exact: true })
  const originalSystem = await system.inputValue()
  const originalTemplate = await template.inputValue()
  assert.match(originalSystem, /^You are a professional \{\{targetLanguage\}\} native translator/)
  assert.match(originalSystem, /4\. For content that should not be translated/)
  assert.equal(originalTemplate, "Translate to {{targetLanguage}}:\n\n\n{{input}}")
  await screenshot(page, "desktop-prompt-editing")
  await template.fill("Translate this")
  assert.equal(await template.getAttribute("aria-invalid"), "true")
  assert.equal(await quality.getByRole("button", { name: "应用", exact: true }).isDisabled(), true)
  await screenshot(page, "desktop-prompt-invalid")
  await template.fill("Translate briefly: {{input}}")
  await page.locator("nav a[href='#reading']").click()
  await page.locator("nav a[href='#quality']").click()
  assert.equal(await template.inputValue(), "Translate briefly: {{input}}", "navigation retains the prompt draft")
  await quality.getByRole("button", { name: "取消", exact: true }).click()
  await quality.getByRole("button", { name: "修改", exact: true }).click()
  assert.equal(await system.inputValue(), originalSystem)
  assert.equal(await template.inputValue(), originalTemplate, "cancel leaves original prompt contents intact")

  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
  await screenshot(page, "mobile-prompt-editing")
  await quality.getByRole("button", { name: "取消", exact: true }).click()
  for (const section of ["service", "reading", "features", "shortcut", "appearance", "backup"]) {
    await page.locator(`nav a[href='#${section}']`).click()
    await noOverflow(page)
    await screenshot(page, `mobile-${section}`)
  }

  await page.locator("nav a[href='#appearance']").click()
  const chineseLanguage = page.getByRole("combobox", { name: "界面语言", exact: true })
  await chineseLanguage.focus()
  await page.keyboard.press("Enter")
  await noOverflow(page)
  await screenshot(page, "mobile-select-open")
  await page.keyboard.press("Escape")
  assert.equal(await chineseLanguage.getAttribute("data-value"), "zh-CN")
  await page.setViewportSize({ width: 1440, height: 960 })
  await chineseLanguage.click()
  await screenshot(page, "desktop-select-open")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "暗色", exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll("#appearance button")].some(button => button.textContent === "暗色" && button.getAttribute("aria-pressed") === "true"))
  await screenshot(page, "dark-appearance")
  await page.locator("nav a[href='#quality']").click()
  await quality.getByRole("button", { name: "修改", exact: true }).click()
  await screenshot(page, "dark-prompt-editing")
  await page.locator("nav a[href='#features']").click()
  const range = page.getByRole("slider", { name: "字幕字号", exact: true })
  await range.focus()
  const previous = Number(await range.inputValue())
  await page.keyboard.press("ArrowRight")
  await page.waitForFunction(value => document.querySelector("input[type='range']")?.value === String(value), previous + 1)
  assert.equal((await storedConfig(context)).features.subtitleStyle.fontSize, previous + 1)
  await screenshot(page, "dark-video-range-focus")
  await page.keyboard.press("End")
  await page.waitForFunction(() => document.querySelector("input[type='range']")?.value === "80")
  await screenshot(page, "dark-video-max-font")
  const captionFits = await page.getByLabel("字幕预览", { exact: true }).evaluate((frame) => {
    const bounds = frame.getBoundingClientRect()
    const caption = frame.querySelector(".subtitle-preview-scene")?.lastElementChild?.getBoundingClientRect()
    return caption && caption.left >= bounds.left && caption.right <= bounds.right && caption.top >= bounds.top && caption.bottom <= bounds.bottom
  })
  assert.equal(captionFits, true, "the largest subtitle preview fits the video frame")
  for (const width of [500, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const language of ["en", "ru", "vi"]) {
      await page.locator("nav a[href='#appearance']").click()
      await page.getByRole("combobox").click()
      await page.locator(`[role='option'][data-value='${language}']`).click()
      await page.waitForFunction(language => document.documentElement.lang === language, language)
      await noOverflow(page)
      await page.locator("nav a[href='#shortcut']").click()
      await noOverflow(page)
    }
  }
  const prompts = (await storedConfig(context)).translate.customPromptsConfig
  assert.equal(prompts.promptId, null, "the layout and cancelled edits keep the default prompt")
})
