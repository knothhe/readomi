/* global chrome -- page.evaluate() reads extension storage in its isolated test profile. */
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, reportFailure, storedConfig, waitForStoredConfig } from "./browser.mjs"
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

async function workspaceGeometry(page) {
  return page.evaluate(() => {
    const bounds = (element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top + scrollY, bottom: rect.bottom + scrollY, width: rect.width, height: rect.height }
    }
    const sidebar = document.querySelector(".options-sidebar")
    const navigation = document.querySelector(".options-navigation")
    const footer = document.querySelector(".options-sidebar-footer")
    const section = document.querySelector(".options-main > div:not([hidden]) > .settings-section")
    const form = section.querySelector(".settings-shortcuts, .settings-backup-content")
    const shellStyle = getComputedStyle(document.querySelector(".options-shell"))
    const sidebarStyle = getComputedStyle(sidebar)
    const footerStyle = getComputedStyle(footer)
    return {
      viewport: document.documentElement.clientWidth,
      dpr: devicePixelRatio,
      scrollTop: scrollY,
      shell: bounds(document.querySelector(".options-shell")),
      shellPaddingTop: Number.parseFloat(shellStyle.paddingTop),
      shellPaddingBottom: Number.parseFloat(shellStyle.paddingBottom),
      sidebar: bounds(sidebar),
      brand: bounds(document.querySelector(".options-brand")),
      navigation: bounds(navigation),
      footer: bounds(footer),
      main: bounds(document.querySelector(".options-main")),
      section: bounds(section),
      title: bounds(section.querySelector(".settings-page-title")),
      formWidth: form?.getBoundingClientRect().width,
      sidebarBackground: sidebarStyle.backgroundColor,
      sidebarBackgroundImage: sidebarStyle.backgroundImage,
      sidebarBorders: [sidebarStyle.borderTopWidth, sidebarStyle.borderRightWidth, sidebarStyle.borderBottomWidth, sidebarStyle.borderLeftWidth].map(Number.parseFloat),
      footerDisplay: footerStyle.display,
      footerPaddingLeft: Number.parseFloat(footerStyle.paddingLeft),
      navigationWrap: getComputedStyle(navigation).flexWrap,
    }
  })
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1, `${message}: expected ${expected}, got ${actual}`)
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    return [...document.querySelectorAll("main section:not([hidden]) input, main section:not([hidden]) textarea, main section:not([hidden]) button, .settings-select-menu")]
      .filter(element => element.getClientRects().length && !element.closest(".settings-reading-style-options"))
      .map(element => ({ label: element.getAttribute("aria-label") ?? element.id ?? element.tagName, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }))
      .filter(rect => rect.left < -1 || rect.right > viewport + 1)
  })
  assert.deepEqual(overflow, [], "controls fit the viewport")
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "page has no horizontal overflow")
  const layout = await workspaceGeometry(page)
  const mobile = layout.viewport <= 600
  near(layout.shell.width, mobile ? layout.viewport - 36 : Math.min(layout.viewport - 56, 1260), "the workspace uses its designed width")
  near(layout.shell.left, (layout.viewport - layout.shell.width) / 2, "navigation and content share a centered workspace")
  near(layout.shell.top + layout.shellPaddingTop, mobile ? 24 : 48, "the workspace starts below the page edge")
  near(layout.section.left, layout.main.left, "sections share the content's left edge")
  assert.equal(layout.sidebarBackground, "rgba(0, 0, 0, 0)", "navigation has no separate background panel")
  assert.equal(layout.sidebarBackgroundImage, "none")
  assert.deepEqual(layout.sidebarBorders, [0, 0, 0, 0], "navigation has no enclosing or divider border")
  if (mobile) {
    near(layout.main.left, layout.shell.left, "mobile content uses the workspace's left edge")
    near(layout.main.top - layout.sidebar.bottom, 28, "mobile navigation and content are separated by the designed gap")
    near(layout.sidebar.bottom, layout.navigation.bottom, "mobile navigation keeps its natural height")
    near(layout.shellPaddingBottom, 40, "mobile pages keep space below the workspace")
    assert.equal(layout.navigationWrap, "wrap", "mobile navigation wraps naturally")
    assert.equal(layout.footerDisplay, "none")
  }
  else {
    assert.ok(layout.sidebar.width >= 184 && layout.sidebar.width <= 240, "navigation adapts to its text within the designed width")
    near(layout.sidebar.left, layout.shell.left, "navigation begins at the workspace's left edge")
    near(layout.main.left - layout.sidebar.right, layout.viewport <= 860 ? 24 : 36, "desktop columns use the designed gap")
    near(layout.navigation.top - layout.brand.bottom, 28, "navigation follows the brand with a quiet gap")
    near(layout.footer.top - layout.navigation.bottom, 24, "the version follows navigation instead of sitting at the viewport bottom")
    near(layout.sidebar.bottom, layout.footer.bottom, "desktop navigation keeps its natural height")
    near(layout.footerPaddingLeft, 12, "the version label aligns with navigation text")
    assert.notEqual(layout.footerDisplay, "none")
    if (layout.scrollTop === 0) {
      near(layout.brand.top, layout.title.top, "the brand and page title share the workspace's top edge")
      near(layout.title.top, layout.shell.top + layout.shellPaddingTop, "the page title begins at the workspace's top edge")
    }
  }
  return layout
}

it("centers the settings workspace on wide screens and restores shortcut defaults", async () => {
  service = await startFakeService()
  const launched = await launchBrowser({ deviceScaleFactor: 2 })
  context = launched.context
  const { page, extensionId } = launched
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  for (const width of [1920, 2504, 2560, 3840]) {
    await page.setViewportSize({ width, height: width === 2504 ? 1302 : 1440 })
    let starts
    for (const section of ["service", "reading", "features", "quality", "shortcut", "appearance", "cache", "backup"]) {
      await page.locator(`nav a[href='#${section}']`).click()
      const layout = await noOverflow(page)
      const nextStarts = { sidebarLeft: layout.sidebar.left, sidebarTop: layout.sidebar.top, mainLeft: layout.main.left, mainTop: layout.main.top, titleTop: layout.title.top }
      if (starts)
        assert.deepEqual(nextStarts, starts, "switching pages preserves navigation and content starting positions")
      else
        starts = nextStarts
      assert.equal(layout.dpr, 2)
      assert.ok(layout.section.width <= layout.main.width + 1, "sections fit the content column")
      if (["service", "quality", "shortcut", "appearance", "cache", "backup"].includes(section))
        assert.ok(layout.section.width <= 760, "single-column settings retain a readable form width")
      if (layout.formWidth)
        assert.ok(layout.formWidth <= 760, "forms keep the designed maximum width")
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
  await waitForStoredConfig(context, config => config.features.modeShortcut === "Alt+E")
  assert.equal((await storedConfig(context)).features.modeShortcut, "Alt+E")
  assert.equal(await pageKey.locator("kbd").count(), 2, "the shortcut is rendered as individual key buttons")
  await modeKey.click()
  assert.equal(await modeKey.getAttribute("data-recording"), "true")
  await screenshot(page, "wide-shortcut-recording")
  await page.getByRole("button", { name: "Restore defaults", exact: true }).click()
  const defaults = await waitForStoredConfig(context, config => config.translate.page.shortcut === "Alt+E" && config.features.modeShortcut === "Alt+M" && config.features.subtitlesShortcut === "Alt+V")
  assert.equal(defaults.translate.page.shortcut, "Alt+E")
  assert.equal(defaults.features.modeShortcut, "Alt+M")
  assert.equal(defaults.features.subtitlesShortcut, "Alt+V")
  assert.equal(defaults.features.hoverHotkey, "control", "restoring shortcuts preserves the hover trigger")
  assert.equal(await modeKey.getAttribute("data-recording"), "false")
  await screenshot(page, "wide-shortcut-restored")
  await page.reload()
  await pageKey.waitFor()
  assert.match(await pageKey.textContent(), /E/)
  assert.equal(await modeKey.getAttribute("data-shortcut"), "Alt+M")
  assert.equal(await subtitlesKey.getAttribute("data-shortcut"), "Alt+V", "restored shortcut values persist after reload")
  await modeKey.click()
  await page.evaluate(() => {
    window.location.hash = "appearance"
  })
  await page.getByRole("heading", { name: "Appearance", exact: true }).waitFor()
  await page.keyboard.press("Alt+K")
  assert.equal((await storedConfig(context)).features.modeShortcut, "Alt+M", "hidden recorders leave keys on another settings page alone")
  await page.goBack()
  await page.getByRole("heading", { name: "Shortcut", exact: true }).waitFor()
  assert.equal(await modeKey.getAttribute("data-recording"), "false", "history navigation cancels recording")
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
  await screenshot(page, "mobile-shortcut-restored")
  const originalAppearance = (await storedConfig(context)).appearance.mode
  await page.setViewportSize({ width: 2504, height: 1302 })
  await page.locator("nav a[href='#appearance']").click()
  await page.getByRole("group", { name: "Appearance", exact: true }).getByRole("button", { name: "Dark", exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"))
  for (const section of ["service", "features"]) {
    await page.locator(`nav a[href='#${section}']`).click()
    await noOverflow(page)
    await screenshot(page, `wide-dark-${section}`)
  }
  await page.locator("nav a[href='#appearance']").click()
  await page.getByRole("group", { name: "Appearance", exact: true }).getByRole("button", { name: { system: "System", light: "Light", dark: "Dark" }[originalAppearance], exact: true }).click()
  await page.waitForFunction(async mode => (await chrome.storage.local.get("config")).config.appearance.mode === mode, originalAppearance)
  await page.locator("nav a[href='#shortcut']").click()
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
  for (const section of ["service", "reading", "features", "quality", "shortcut", "appearance", "cache", "backup"]) {
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
  for (const section of ["service", "reading", "features", "shortcut", "appearance", "cache", "backup"]) {
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
  await page.getByText("自定义", { exact: true }).click()
  const range = page.getByRole("slider", { name: "字幕大小", exact: true })
  await range.focus()
  const previous = Number(await range.inputValue())
  await page.keyboard.press("ArrowRight")
  await page.waitForFunction(value => document.querySelector("input[type='range']")?.value === String(value), previous + 5)
  await waitForStoredConfig(context, config => config.features.subtitleStyle.relativeFontSize === (previous + 5) / 20)
  assert.equal((await storedConfig(context)).features.subtitleStyle.relativeFontSize, (previous + 5) / 20)
  await screenshot(page, "dark-video-range-focus")
  await page.keyboard.press("End")
  await page.waitForFunction(() => document.querySelector("input[type='range']")?.value === "500")
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

it("keeps custom subtitle controls steady and offers all reading styles in a horizontal list", async () => {
  service = await startFakeService()
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await page.setViewportSize({ width: 1440, height: 1000 })
  await configureService(page, extensionId, setupDocumentFor(service.origin))
  await page.locator("nav a[href='#reading']").click()
  const videoNavigation = page.locator("nav a[href='#features']")
  const beforeNavigation = await videoNavigation.evaluate(link => ({ width: link.getBoundingClientRect().width, height: link.getBoundingClientRect().height, labelHeight: link.querySelector(".options-nav-label").getBoundingClientRect().height }))
  await videoNavigation.click()
  const afterNavigation = await videoNavigation.evaluate(link => ({ width: link.getBoundingClientRect().width, height: link.getBoundingClientRect().height, labelHeight: link.querySelector(".options-nav-label").getBoundingClientRect().height }))
  assert.deepEqual(afterNavigation, beforeNavigation, "selecting Video subtitles keeps the same single-line navigation dimensions")
  assert.ok(afterNavigation.labelHeight < 25, "the Video subtitles label remains one line")
  const custom = page.locator(".subtitle-custom")
  const obsoleteModes = page.getByRole("group", { name: "Size mode", exact: true })
  assert.equal(await custom.evaluate(details => details.open), false)
  assert.equal(await obsoleteModes.count(), 0)
  assert.equal(await page.getByRole("switch", { name: "Subtitle background", exact: true }).count(), 0)
  await custom.locator("summary").click()
  const depth = page.getByRole("spinbutton", { name: "Background depth", exact: true })
  const depthSlider = page.getByRole("slider", { name: "Background depth", exact: true })
  const size = page.getByRole("spinbutton", { name: "Subtitle size", exact: true })
  const frameGeometry = () => page.locator(".subtitle-settings-group").evaluate((group) => {
    const caption = document.querySelector(".subtitle-preview-caption")
    const box = caption.getBoundingClientRect()
    return { groupHeight: group.getBoundingClientRect().height, captionWidth: box.width, captionHeight: box.height }
  })
  const plain = await frameGeometry()
  assert.equal(await depth.inputValue(), "0")
  await depth.fill("35")
  await depth.press("Enter")
  await waitForStoredConfig(context, config => config.features.subtitleStyle.backgroundOpacity === 35 && config.features.subtitleStyle.backgroundEnabled)
  assert.deepEqual(await frameGeometry(), plain, "adding a background preserves the custom layout and caption padding")
  assert.equal((await storedConfig(context)).features.subtitleStyle.backgroundEnabled, true)
  await depthSlider.press("Home")
  await waitForStoredConfig(context, config => config.features.subtitleStyle.backgroundOpacity === 0 && !config.features.subtitleStyle.backgroundEnabled)
  assert.equal((await storedConfig(context)).features.subtitleStyle.backgroundEnabled, false)
  assert.deepEqual(await frameGeometry(), plain)
  const presets = page.getByRole("group", { name: "Subtitle preset", exact: true })
  await presets.getByRole("button", { name: "Compact", exact: true }).click()
  assert.equal(await depth.inputValue(), "35")
  assert.equal(await size.inputValue(), "80")
  assert.equal(await custom.evaluate(details => details.open), true, "preset selection retains the expanded custom section")
  assert.equal((await frameGeometry()).groupHeight, plain.groupHeight)
  await presets.getByRole("button", { name: "Focus", exact: true }).click()
  assert.equal(await depth.inputValue(), "65")
  assert.equal(await size.inputValue(), "125")
  await page.getByRole("group", { name: "Common sizes", exact: true }).getByRole("button", { name: "150%", exact: true }).click()
  assert.equal(await size.inputValue(), "150")
  await screenshot(page, "video-custom-light")
  for (const width of [1440, 1280, 1024, 900, 861, 860, 600, 500, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await noOverflow(page)
    const clippedPresets = await presets.getByRole("button").evaluateAll(buttons => buttons.filter(button => button.scrollWidth > button.clientWidth + 1).map(button => button.textContent))
    assert.deepEqual(clippedPresets, [], `preset labels fit at ${width}px`)
    const controlsOverlap = await page.locator(".subtitle-font-row .settings-row-heading").evaluate((heading) => {
      const label = heading.firstElementChild.getBoundingClientRect()
      const choices = heading.lastElementChild.getBoundingClientRect()
      return label.right > choices.left + 1 && label.left < choices.right - 1 && label.bottom > choices.top + 1 && label.top < choices.bottom - 1
    })
    assert.equal(controlsOverlap, false, `the size label and presets do not overlap at ${width}px`)
  }
  await screenshot(page, "video-custom-mobile")
  await page.locator("nav a[href='#reading']").click()
  const styles = page.locator(".settings-reading-style-options")
  assert.equal(await styles.getByRole("button").count(), 9)
  assert.equal(await styles.evaluate(list => list.scrollWidth > list.clientWidth), true)
  await styles.getByRole("button").last().click()
  await waitForStoredConfig(context, config => config.translate.translationNodeStyle.preset === "blur")
  assert.equal((await storedConfig(context)).translate.translationNodeStyle.preset, "blur")
  assert.equal(await styles.evaluate(list => list.scrollLeft > 0), true, "offscreen choices scroll into view")
  await noOverflow(page)
  await screenshot(page, "reading-horizontal-styles")
})
