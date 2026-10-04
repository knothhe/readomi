/* global chrome -- callbacks run in the extension service worker. */
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { mkdir } from "node:fs/promises"
import http from "node:http"
import { resolve } from "node:path"
import process from "node:process"
import { afterEach, it } from "node:test"
import { configureService, launchBrowser, pressTranslateShortcut, reportFailure } from "./browser.mjs"
import { setupDocumentFor } from "./fake-service.mjs"

const SOURCE = "Keep code, identifiers, proper nouns and inline formatting as they are."
const TRANSLATED = "保留代码、标识符、专有名词和行内格式。"
const INVALID_REASON = "The translation language or content does not meet the requirements. Please retry."
let context
let service

afterEach(async (test) => {
  try {
    service?.releaseWrongStream()
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
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`${description}: ${JSON.stringify(value)}`)
}

/** An isolated service that can return the two observed invalid results. */
async function startQualityService() {
  const requests = []
  let mode = "wrong-route"
  let wrongStreamBodySent = false
  let releaseWrongStream = () => {}
  const streamCompletion = new Promise(resolve => releaseWrongStream = resolve)
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost")
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.statusCode = 204
      response.end()
      return
    }
    if (request.method === "GET" && url.pathname === "/quality") {
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      // Empty title and a nontranslated heading keep the source and context
      // identical when checking failure and success cache behavior across pages.
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title></title></head><body style="max-width:670px;margin:40px auto;font:16px/1.8 system-ui"><h1 class="notranslate">Translation quality</h1><p id="source">${SOURCE}</p></body></html>`)
      return
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const chunks = []
      for await (const chunk of request)
        chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const user = [...body.messages].reverse().find(message => message.role === "user")?.content ?? ""
      const source = user.match(/<(readomi_source_\d+)>\n([\s\S]*)\n<\/\1>/)?.[2] ?? user
      const system = body.messages.filter(message => message.role === "system").map(message => message.content).join("\n")
      const qualityRequest = source.trim() === SOURCE
      requests.push({ source, mode, body, qualityRequest })
      // Setup validation still gets a successful ordinary response. Only the
      // issue sentence participates in controlled failures and request counts.
      let text = system.includes("Primary language:") ? "[[readomi:primary]]\n你好，世界。" : "你好，世界。"
      if (qualityRequest) {
        text = mode === "wrong-route" || mode === "wrong-stream"
          ? `[[readomi:secondary]]\n${SOURCE}`
          : mode === "echo" ? `[[readomi:primary]]\n${SOURCE}` : `[[readomi:primary]]\n${TRANSLATED}`
      }
      if (body.stream) {
        response.setHeader("Content-Type", "text/event-stream")
        for (let index = 0; index < text.length && !response.destroyed; index += 8) {
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(index, index + 8) } }] })}\n\n`)
          await new Promise(resolve => setTimeout(resolve, 15))
        }
        if (qualityRequest && mode === "wrong-stream") {
          wrongStreamBodySent = true
          await streamCompletion
        }
        response.end("data: [DONE]\n\n")
        return
      }
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify({
        id: "chatcmpl-quality-e2e",
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
      return
    }
    response.statusCode = 404
    response.end("Not found")
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    translations: () => requests.filter(request => request.qualityRequest),
    setMode: value => mode = value,
    wrongStreamBodySent: () => wrongStreamBodySent,
    releaseWrongStream,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

async function setup(mode = "bilingual") {
  service = await startQualityService()
  const launched = await launchBrowser()
  context = launched.context
  await configureService(launched.page, launched.extensionId, setupDocumentFor(service.origin))
  await context.serviceWorkers()[0].evaluate(async (mode) => {
    const { config } = await chrome.storage.local.get("config")
    config.translate.enableAIContentAware = false
    config.translate.mode = mode
    config.features.hoverTranslation = true
    config.features.hoverStream = true
    await chrome.storage.local.set({ config })
  }, mode)
}

async function article(suffix) {
  const page = await context.newPage()
  await page.goto(`${service.origin}/quality?case=${suffix}`)
  return page
}

async function screenshot(page, name) {
  if (!process.env.E2E_ARTIFACTS)
    return
  await mkdir(process.env.E2E_ARTIFACTS, { recursive: true })
  await page.screenshot({ path: resolve(process.env.E2E_ARTIFACTS, name), fullPage: true })
}

async function assertSourceOnce(paragraph) {
  assert.equal((await paragraph.textContent()).split(SOURCE).length - 1, 1, "the original source remains readable exactly once")
}

async function assertFailure(page) {
  const paragraph = page.locator("#source")
  await paragraph.getByText(INVALID_REASON, { exact: false }).waitFor({ timeout: 20_000 })
  await paragraph.getByRole("button", { name: "Retry", exact: true }).waitFor()
  await assertSourceOnce(paragraph)
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0, "bounded retries finish instead of spinning indefinitely")
  assert.equal(await paragraph.getByText(/selected the wrong|repeated the source/).count(), 0, "technical quality diagnostics are localized")
  return paragraph
}

it("rejects wrong directions and copied prose after two retries, leaves failures uncached and recovers through the retry button", async () => {
  await setup()
  const wrongDirection = await article("wrong-direction")
  await pressTranslateShortcut(wrongDirection)
  await assertFailure(wrongDirection)
  await screenshot(wrongDirection, "translation-quality-failed.png")
  assert.equal(service.translations().length, 3, "a wrong direction makes the initial attempt and exactly two automatic retries")
  assert.ok(service.translations().slice(1).every(({ body }) => body.messages.some(message => message.content.includes("Correct the Invalid Translation Response"))), "automatic retries include the correction instruction")
  await wrongDirection.close()

  service.setMode("echo")
  const echoed = await article("copied-prose")
  await pressTranslateShortcut(echoed)
  const paragraph = await assertFailure(echoed)
  assert.equal(service.translations().length, 6, "failure was not cached; repeated prose independently exhausts the retry limit")

  service.setMode("success")
  await paragraph.getByRole("button", { name: "Retry", exact: true }).click()
  await paragraph.getByText(TRANSLATED, { exact: true }).waitFor()
  assert.equal(service.translations().length, 7, "the manual retry makes a fresh request")
  assert.equal(await paragraph.getByRole("button", { name: "Retry", exact: true }).count(), 0)
  await assertSourceOnce(paragraph)
  await screenshot(echoed, "translation-quality-ready.png")
  await echoed.close()

  const cached = await article("successful-cache")
  await pressTranslateShortcut(cached)
  await cached.locator("#source").getByText(TRANSLATED, { exact: true }).waitFor()
  assert.equal(service.translations().length, 7, "a validated successful result is cached for the same source and language policy")
  await assertSourceOnce(cached.locator("#source"))
})

it("suppresses a hover stream with the wrong direction before retrying into readable Chinese", async () => {
  await setup()
  service.setMode("wrong-stream")
  const page = await article("hover")
  const paragraph = page.locator("#source")
  await paragraph.hover()
  await page.keyboard.press("Alt")
  await waitFor(() => service.wrongStreamBodySent(), Boolean, "the first invalid stream has sent its entire body")
  assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0, "a wrong route never creates a readable streaming preview")
  assert.equal(await paragraph.textContent(), SOURCE, "wrong streamed output does not duplicate or replace the original")
  assert.equal(await paragraph.locator(".readomi-spinner:visible").count(), 1)
  service.setMode("success")
  service.releaseWrongStream()
  await paragraph.getByText(TRANSLATED, { exact: true }).waitFor({ timeout: 20_000 })
  assert.equal(service.translations().length, 2, "the rejected hover stream retries once and accepts the corrected result")
  assert.ok(service.translations().every(({ body }) => body.stream === true), "hover retries retain the streaming transport")
  assert.equal(await page.locator("[data-readomi-inline-preview]").count(), 0)
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
  await assertSourceOnce(paragraph)
  await screenshot(page, "translation-quality-hover-ready.png")
  assert.equal((await page.locator("body").textContent()).includes("[[readomi:"), false)
})

it("keeps the source after a translation-only quality failure and replaces it after a successful manual retry", async () => {
  await setup("translationOnly")
  const page = await article("translation-only-retry")
  await pressTranslateShortcut(page)
  const paragraph = await assertFailure(page)
  assert.equal(service.translations().length, 3, "translation-only failures also exhaust exactly two automatic retries")
  await screenshot(page, "translation-quality-only-failed.png")
  service.setMode("success")
  await paragraph.getByRole("button", { name: "Retry", exact: true }).click()
  await paragraph.getByText(TRANSLATED, { exact: true }).waitFor()
  assert.equal((await paragraph.textContent()).trim(), TRANSLATED, "a successful retry replaces the preserved source")
  assert.equal(service.translations().length, 4, "the manual retry makes one fresh successful request")
  assert.equal(await paragraph.getByRole("button", { name: "Retry", exact: true }).count(), 0)
  assert.equal(await paragraph.locator(".readomi-spinner").count(), 0)
  await screenshot(page, "translation-quality-only-ready.png")
})
