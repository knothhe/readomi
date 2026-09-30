import assert from "node:assert/strict"
import { it } from "node:test"
import { configureService, launchBrowser, pressTranslateShortcut, reportFailure } from "./browser.mjs"
import { setupDocumentFor, startFakeService } from "./fake-service.mjs"

it("page translation preserves display contents grid columns in bilingual, translation only and restored states", async (test) => {
  const service = await startFakeService()
  let context
  try {
    const launched = await launchBrowser()
    context = launched.context
    const { page: popup, extensionId } = launched
    await configureService(popup, extensionId, setupDocumentFor(service.origin))
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    const article = await context.newPage()
    await article.goto(`${service.origin}/grid-contents`)
    const original = await article.locator("article").textContent()
    const date = await article.locator("time").textContent()
    const layout = () => article.evaluate(() => {
      const meta = document.querySelector(".email-meta")
      return {
        width: meta.getBoundingClientRect().width,
        rows: [...meta.querySelectorAll("p")].map(row => ({
          display: getComputedStyle(row).display,
          key: row.querySelector(".key").getBoundingClientRect().toJSON(),
          value: row.querySelector(".value").getBoundingClientRect().toJSON(),
        })),
        wrappers: [...meta.querySelectorAll(".jiandao-translated-content-wrapper")].map(wrapper => wrapper.parentElement.className),
      }
    })
    const assertColumns = async () => {
      const current = await layout()
      assert.equal(current.rows.length, 4)
      for (const row of current.rows) {
        assert.equal(row.display, "contents")
        assert.ok(row.value.width > current.width / 2, `value column was squeezed: ${JSON.stringify(current)}`)
        assert.ok(row.value.x > row.key.x)
        assert.ok(Math.abs(row.key.y - row.value.y) < 32, "each key stays beside its value")
      }
      assert.ok(current.wrappers.length > 0, "the metadata was translated")
      assert.ok(current.wrappers.every(parent => parent === "key" || parent === "value"), `translation escaped a grid cell: ${current.wrappers}`)
      assert.equal(await article.locator("time").textContent(), date, "the date remains untouched")
    }
    await pressTranslateShortcut(article)
    await article.waitForFunction(() => document.querySelector(".prose h2").textContent.includes("【译】"))
    await assertColumns()
    assert.equal(await article.locator(".email-meta a[href=\"mailto:hello@example.com\"]").count(), 1)
    assert.equal(await article.locator(".prose a[href=\"https://example.com/\"]").count(), 1)

    await popup.getByRole("button", { name: "Translation only", exact: true }).click()
    await article.waitForFunction(() => document.querySelector(".prose h2").textContent.trim().startsWith("【译】"))
    await assertColumns()

    await pressTranslateShortcut(article)
    await article.waitForFunction(() => !document.querySelector(".jiandao-translated-content-wrapper"))
    assert.equal(await article.locator("article").textContent(), original)
    assert.equal(await article.locator(".email-meta a[href=\"mailto:hello@example.com\"]").count(), 1)
    assert.equal(await article.locator(".prose a[href=\"https://example.com/\"]").count(), 1)
    const restored = await layout()
    assert.ok(restored.rows.every(row => row.display === "contents" && row.value.width > restored.width / 2))
  }
  catch (error) {
    await reportFailure({ name: test.name, error, diagnostic: text => test.diagnostic(text) }, context)
    throw error
  }
  finally {
    await context?.close()
    await service.close()
  }
})
