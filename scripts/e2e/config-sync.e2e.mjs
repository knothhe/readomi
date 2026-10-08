/* global chrome -- callbacks execute inside the isolated extension test profile. */
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { it } from "node:test"
import { launchBrowser, storedConfig } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

it("shows browser availability, retains file backup, and fits desktop and narrow screens", async () => {
  const { context, page, extensionId } = await launchBrowser()
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html#backup`)
    await page.getByRole("heading", { name: "Backup & sync", exact: true }).waitFor()
    const toggle = page.getByRole("switch", { name: "Sync this device", exact: true })
    const nativeChrome = await page.evaluate(() => navigator.userAgentData?.brands.some(item => item.brand === "Google Chrome") ?? false)
    await page.waitForFunction(() => !document.querySelector("#backup")?.textContent.includes("Detecting…"))
    assert.equal(await toggle.isEnabled(), nativeChrome)
    if (!nativeChrome)
      await page.getByText("This version supports Chrome only. File backups are still available.").waitFor()
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 960 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
      await mkdir("/private/tmp/readomi-sync-browser-qa", { recursive: true })
      await page.screenshot({ path: join("/private/tmp/readomi-sync-browser-qa", `backup-${width}.png`), fullPage: true })
    }
    if (nativeChrome) {
      await toggle.click()
      await page.getByText("Saved for Chrome to sync", { exact: true }).waitFor()
      const snapshot = await page.evaluate(() => chrome.storage.sync.get(null))
      assert.ok(snapshot["readomi.sync.v1.manifest"])
      await toggle.click()
    }
    const previous = await storedConfig(context)
    const candidate = { ...previous, features: { ...previous.features, hoverTranslation: !previous.features.hoverTranslation } }
    const backup = page.locator("#backup")
    await backup.getByRole("button", { name: "Import", exact: true }).click()
    await backup.locator("input[type=file]").setInputFiles({ name: "readomi-config.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "readomi-config", config: candidate })) })
    const dialog = page.getByRole("dialog", { name: "Import configuration", exact: true })
    await dialog.waitFor()
    const centered = await dialog.boundingBox()
    assert.ok(centered.y > 100, "confirmation dialog is centered rather than pinned to the corner")
    assert.equal((await storedConfig(context)).features.hoverTranslation, previous.features.hoverTranslation)
    await page.screenshot({ path: "/private/tmp/readomi-sync-browser-qa/import-confirmation.png", fullPage: true })
    await dialog.getByRole("button", { name: "Replace all settings", exact: true }).click()
    await page.getByText("Configuration imported.", { exact: true }).waitFor()
    assert.equal((await storedConfig(context)).features.hoverTranslation, candidate.features.hoverTranslation)
  }
  finally {
    await context.close()
  }
})

it("fills a synced service key, retains its identity and shows a masked saved key after reload", async () => {
  const service = await startFakeService()
  const { context, page, extensionId } = await launchBrowser()
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html#backup`)
    await page.getByRole("heading", { name: "Backup & sync", exact: true }).waitFor()
    const initial = await storedConfig(context)
    const document = setupDocumentFor(service.origin)
    const synced = { ...initial.providersConfig[0], id: "synced-service", name: "Synced service", provider: document.type, model: document.model, baseURL: document.baseURL, api: document.api }
    delete synced.apiKey
    delete synced.connectionCheck
    await context.serviceWorkers()[0].evaluate(config => chrome.storage.local.set({ config }), { ...initial, providersConfig: [synced], translate: { ...initial.translate, providerId: synced.id } })
    await page.goto(`chrome-extension://${extensionId}/options.html#service`)
    const section = page.locator("#service")
    const row = section.locator(".settings-service-row")
    await row.getByRole("heading", { name: synced.name, exact: true }).waitFor()
    await row.getByText("The configuration has no API key", { exact: true }).waitFor()
    assert.equal(await row.getByRole("radio").isDisabled(), true)
    await row.locator("summary").click()
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await section.getByLabel("API Key", { exact: true }).fill("sk-filled-local-key")
    await section.getByRole("button", { name: "Check and save", exact: true }).click()
    await section.getByRole("heading", { name: synced.name, exact: true }).waitFor()
    const saved = await storedConfig(context)
    assert.equal(saved.providersConfig.length, 1)
    assert.equal(saved.providersConfig[0].id, synced.id)
    assert.equal(saved.providersConfig[0].apiKey, "sk-filled-local-key")
    await page.reload()
    await row.getByRole("heading", { name: synced.name, exact: true }).waitFor()
    await row.locator("summary").click()
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    const key = section.getByLabel("API Key", { exact: true })
    assert.equal(await key.inputValue(), "")
    assert.equal(await key.getAttribute("placeholder"), "sk-…-key")
    await mkdir("/private/tmp/readomi-sync-browser-qa", { recursive: true })
    await page.screenshot({ path: "/private/tmp/readomi-sync-browser-qa/saved-key-editor.png", fullPage: true })
    await section.getByRole("button", { name: "Check and save", exact: true }).click()
    await section.getByRole("heading", { name: synced.name, exact: true }).waitFor()
    assert.equal((await storedConfig(context)).providersConfig[0].apiKey, "sk-filled-local-key")
  }
  finally {
    await context.close()
    await service.close()
  }
})
