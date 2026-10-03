import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { launchBrowser, reportFailure, storedConfig } from "./browser.mjs"

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

it("changes interface language across open settings and popup, preserves it on reload and returns to browser language", async () => {
  const launched = await launchBrowser()
  context = launched.context
  const { page, extensionId } = launched
  await page.goto(`chrome-extension://${extensionId}/options.html#appearance`)
  const select = page.locator("#appearance [role=combobox]")
  const chooseLanguage = async (value) => {
    await select.click()
    await page.locator(`[role=option][data-value="${value}"]`).click()
  }
  await select.waitFor()
  const original = await storedConfig(context)
  assert.equal(await select.getAttribute("data-value"), "browser")
  await select.click()
  assert.equal(await page.locator("[role=option]").count(), 10)
  await select.click()
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.getByText("No translation service yet", { exact: true }).waitFor()

  await chooseLanguage("zh-CN")
  await page.getByRole("heading", { name: "外观", exact: true }).waitFor()
  await popup.getByText("还没有翻译服务", { exact: true }).waitFor()
  await popup.getByRole("button", { name: "目标语言", exact: true }).click()
  await popup.getByRole("option", { name: "英语 (English)", exact: true }).waitFor()
  await popup.getByRole("button", { name: "目标语言", exact: true }).click()
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN")
  await page.waitForFunction(() => document.querySelector("#appearance [role=combobox]")?.getAttribute("data-value") === "zh-CN")
  await page.reload()
  await page.getByLabel("界面语言", { exact: true }).waitFor()
  assert.equal(await select.getAttribute("data-value"), "zh-CN")

  await page.setViewportSize({ width: 390, height: 1000 })
  assert.equal(await page.locator("#appearance").evaluate(el => el.scrollWidth <= el.clientWidth), true)
  await chooseLanguage("ja")
  await page.getByLabel("表示言語", { exact: true }).waitFor()
  await popup.getByText("翻訳サービスがまだありません", { exact: true }).waitFor()
  await chooseLanguage("browser")
  await page.getByLabel("Interface language", { exact: true }).waitFor()
  await popup.getByText("No translation service yet", { exact: true }).waitFor()
  const final = await storedConfig(context)
  assert.equal(final.ui.language, "browser")
  assert.deepEqual(final.language, original.language)
  assert.deepEqual(final.providersConfig, original.providersConfig)
})
