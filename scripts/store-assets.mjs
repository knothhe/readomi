/* global chrome */
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { execFileSync } from "node:child_process"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import { resolve } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"
import { chromium } from "playwright-core"
import { configureService, launchBrowser } from "./e2e/browser.mjs"

// Original sample content; deterministic local translations demonstrate the real
// extension UI without a provider account, remote request or private browsing data.
const examples = [
  ["A small habit of reading", "把阅读变成一个小习惯"],
  ["A good idea can start with a single paragraph. Reading gives us time to notice the details and ask better questions.", "一个好想法，可以从一个段落开始。阅读让我们有时间留意细节，也让我们提出更好的问题。"],
  ["You do not need to finish every book. Follow your curiosity, keep a few notes, and return to the pages that matter to you.", "你不必读完每一本书。顺着好奇心读下去，记下几条笔记，再回到那些对你重要的页面。"],
  ["Make room for a little reading each day. Over time, small moments can change the way you see the world.", "每天为阅读留一点时间。日积月累，这些小小的片刻，会改变你看世界的方式。"],
  ["Every new perspective begins with a moment of curiosity.", "每一种新的视角，都始于一个好奇的瞬间。"],
]
const raw = resolve("design/assets/store")
const output = resolve("docs/chrome-web-store/assets")
const kinds = ["bilingual", "translation-only", "hover", "subtitles", "service"]
const slugs = ["01-bilingual", "02-translation-only", "03-hover", "04-subtitles", "05-service"]
const { version } = JSON.parse(await readFile(resolve("package.json"), "utf8"))
const manifest = JSON.parse(await readFile(resolve(".output/chrome-mv3/manifest.json"), "utf8"))
assert.equal(manifest.version, version, "build matches package.json; run pnpm build first")

async function capturePopup(popup, path) {
  await popup.evaluate(() => document.fonts.ready)
  const height = await popup.locator("#root").evaluate(root => Math.ceil(root.getBoundingClientRect().height))
  assert.ok(height <= 508, "the complete popup fits below its 30px inset in the 540px screen")
  await popup.setViewportSize({ width: 320, height })
  await popup.screenshot({ path })
}

function articleHTML() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${examples[0][0]}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffdfb;color:#302b29;font:19px/1.65 Georgia,"Songti SC",serif}header{height:54px;border-bottom:1px solid #e8e0d8;padding:16px 56px;font:12px system-ui;letter-spacing:2px;color:#96877c}article{width:660px;margin:25px 56px}h1{font-size:31px;line-height:1.25;margin:0 0 22px}p{margin:0 0 24px}.readomi-translated-block-content{font-family:system-ui;font-size:17px;line-height:1.65}
  </style></head><body><header translate="no">THE READING NOTEBOOK · SAMPLE ARTICLE</header><article><h1>${examples[0][0]}</h1>${examples.slice(1, 3).map(([text]) => `<p>${text}</p>`).join("")}</article></body></html>`
}

function silentMedia() {
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
  return media
}

async function startDemoService() {
  const media = silentMedia()
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1")
      if (request.method === "GET" && url.pathname === "/article") {
        response.setHeader("Content-Type", "text/html; charset=utf-8")
        response.end(articleHTML())
        return
      }
      if (url.pathname === "/video") {
        response.setHeader("Content-Type", "text/html; charset=utf-8")
        response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Small moments of curiosity</title><style>body{margin:0;background:#f4f0eb;color:#302b29;font:16px system-ui}header{padding:20px 52px;font-size:18px}video{display:block;margin:0 52px;width:1080px;height:410px;background:#d0c3aa;object-fit:cover}p{margin:14px 52px;font-size:13px;color:#776b60}</style></head><body><header translate="no">THE READING NOTEBOOK · SAMPLE VIDEO</header><video controls muted poster="/poster.svg" src="/silent.wav"><track default kind="subtitles" srclang="en" label="English" src="/captions.vtt"></video><p translate="no">HTML5 video with an existing English subtitle track</p></body></html>`)
        return
      }
      if (url.pathname === "/poster.svg") {
        response.setHeader("Content-Type", "image/svg+xml")
        response.end("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1080\" height=\"410\" viewBox=\"0 0 1080 410\"><rect width=\"1080\" height=\"410\" fill=\"#d8dbcb\"/><circle cx=\"795\" cy=\"100\" r=\"46\" fill=\"#faf0cb\"/><path d=\"M0 270Q160 160 320 250T660 235T1080 240V410H0Z\" fill=\"#9eac93\"/><path d=\"M0 320Q220 215 460 310T1080 270V410H0Z\" fill=\"#738a72\"/><path d=\"M0 390Q260 290 560 370T1080 350V410H0Z\" fill=\"#4d6c62\"/></svg>")
        return
      }
      if (url.pathname === "/captions.vtt") {
        response.setHeader("Content-Type", "text/vtt")
        response.end(`WEBVTT\n\n00:00.000 --> 00:59.000\n${examples[4][0]}\n`)
        return
      }
      if (url.pathname === "/silent.wav") {
        const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/)
        const start = range ? Number(range[1]) : 0
        const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1
        response.statusCode = range ? 206 : 200
        response.setHeader("Content-Type", "audio/wav")
        response.setHeader("Accept-Ranges", "bytes")
        if (range)
          response.setHeader("Content-Range", `bytes ${start}-${end}/${media.length}`)
        response.end(media.subarray(start, end + 1))
        return
      }
      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        let body = ""
        for await (const chunk of request)
          body += chunk
        const json = JSON.parse(body)
        const system = json.messages.find(message => message.role === "system")?.content ?? ""
        const user = json.messages.findLast(message => message.role === "user")?.content ?? ""
        // Demo fixtures are English and use the default Chinese primary target.
        const header = /^Primary language: /m.test(system) ? "[[readomi:primary]]\n" : ""
        const content = user.split(/\r?\n[ \t]*%%[ \t]*\r?\n/).map((part) => {
          const sample = examples.find(([text]) => part.includes(text))
          return `${header}${sample?.[1] ?? "你好"}`
        }).join("\n%%\n")
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }))
        return
      }
      response.statusCode = 404
      response.end("Not found")
    }
    catch {
      response.statusCode = 500
      response.end("Demo request failed")
    }
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

async function captureLocale(locale, service) {
  const { context, page: options, extensionId } = await launchBrowser()
  try {
    // Disallow public-network requests even from the extension's service worker.
    await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort())
    await options.setViewportSize({ width: 1184, height: 540 })
    await configureService(options, extensionId, {
      type: "openai-compatible",
      name: "Demo local",
      apiKey: "demo-only-not-a-secret",
      model: "demo-translator",
      baseURL: `${service.origin}/v1`,
    })
    await options.getByRole("button", { name: "Add service", exact: true }).click()
    await configureService(options, extensionId, {
      type: "openai-compatible",
      name: "Demo alternate",
      apiKey: "demo-only-not-a-secret",
      model: "demo-translator",
      baseURL: `${service.origin}/v1`,
    })
    await options.goto(`chrome-extension://${extensionId}/options.html#appearance`)
    await options.locator("#appearance [role=combobox]").click()
    await options.locator(`[role=option][data-value="${locale}"]`).click()
    await options.waitForFunction(async language => (await chrome.storage.local.get("config")).config.ui.language === language, locale)
    const worker = context.serviceWorkers()[0]
    await worker.evaluate(async () => {
      const { config } = await chrome.storage.local.get("config")
      config.appearance.mode = "light"
      config.features.hoverTranslation = true
      // This fixture is not an SSE server. Show the real non-streaming mode.
      config.features.hoverStream = false
      config.features.hoverHotkey = "control"
      await chrome.storage.local.set({ config })
    })
    const article = await context.newPage()
    await article.setViewportSize({ width: 1184, height: 540 })
    await article.goto(`${service.origin}/article`)
    await article.locator("h1").click()
    await article.keyboard.press("Alt+E")
    await article.locator(".readomi-translated-block-content").nth(2).waitFor({ timeout: 20_000 })
    assert.deepEqual(await article.locator(".readomi-translated-block-content").allTextContents(), examples.slice(0, 3).map(([,text]) => text))
    await article.screenshot({ path: `${raw}/${locale}-bilingual.png` })
    const popup = await context.newPage()
    await popup.setViewportSize({ width: 320, height: 460 })
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await article.bringToFront()
    await popup.reload()
    await popup.getByRole("button", { name: locale === "zh-CN" ? "显示原文" : /Show original/ }).waitFor()
    await capturePopup(popup, `${raw}/${locale}-popup-bilingual.png`)
    await article.bringToFront()
    await article.keyboard.press("Alt+M")
    await article.waitForFunction(() => document.querySelector("article p")?.textContent.startsWith("一个好想法"))
    await article.screenshot({ path: `${raw}/${locale}-translation-only.png` })
    await capturePopup(popup, `${raw}/${locale}-popup-translation-only.png`)
    await article.keyboard.press("Alt+M")
    await article.bringToFront()
    await article.locator("h1").click()
    await article.keyboard.press("Alt+E")
    await article.waitForFunction(() => document.querySelectorAll(".readomi-translated-block-content").length === 0)
    const hoverArticle = await context.newPage()
    const hoverFeatures = await worker.evaluate(async () => (await chrome.storage.local.get("config")).config.features)
    assert.equal(hoverFeatures.hoverTranslation, true, "hover feature enabled")
    assert.equal(hoverFeatures.hoverHotkey, "control", "hover trigger configured")
    await hoverArticle.setViewportSize({ width: 1184, height: 540 })
    await hoverArticle.goto(`${service.origin}/article?hover`)
    await hoverArticle.locator("p").first().click()
    await hoverArticle.locator("p").first().hover()
    await hoverArticle.keyboard.down("Control")
    await hoverArticle.locator(".readomi-translated-block-content").waitFor({ timeout: 10_000 })
    await hoverArticle.keyboard.up("Control")
    assert.equal(await hoverArticle.locator(".readomi-translated-block-content").count(), 1)
    await hoverArticle.mouse.move(4, 4)
    await hoverArticle.screenshot({ path: `${raw}/${locale}-hover.png` })
    await popup.reload()
    await popup.getByRole("switch", { name: locale === "zh-CN" ? "悬停翻译" : "Hover translation", exact: true }).waitFor()
    await capturePopup(popup, `${raw}/${locale}-popup-hover.png`)
    await worker.evaluate(async () => {
      const { config } = await chrome.storage.local.get("config")
      config.features.videoSubtitles = true
      config.features.subtitleStyle.relativeFontSize = 28 / 3.6
      config.features.subtitleStyle.backgroundEnabled = true
      config.features.subtitleStyle.backgroundOpacity = 65
      config.features.subtitleStyle.position = { x: 50, y: 75 }
      await chrome.storage.local.set({ config })
    })
    const video = await context.newPage()
    await video.setViewportSize({ width: 1184, height: 540 })
    await video.goto(`${service.origin}/video`)
    await video.evaluate(async () => {
      const media = document.querySelector("video")
      await media.play()
    })
    // Closed shadow roots are inspected only to verify real captions are rendered.
    const session = await context.newCDPSession(video)
    let captions
    for (let attempt = 0; attempt < 80; attempt++) {
      const tree = await session.send("DOM.getDocument", { depth: -1, pierce: true })
      captions = JSON.stringify(tree)
      if (captions.includes(examples[4][1]))
        break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(captions.includes(examples[4][1]), "translated HTML5 caption rendered")
    await video.evaluate(() => document.querySelector("video").pause())
    await video.mouse.move(4, 4)
    await video.screenshot({ path: `${raw}/${locale}-subtitles.png` })
    await options.goto(`chrome-extension://${extensionId}/options.html#service`)
    const current = options.locator(".settings-service-row[data-current='true']")
    await current.getByText(locale === "zh-CN" ? "已连接" : "Connected", { exact: true }).waitFor()
    await current.locator("summary").click()
    await current.getByRole("button", { name: locale === "zh-CN" ? "连接详情" : "Connection details", exact: true }).click()
    await current.locator(".settings-service-connection").waitFor()
    await options.mouse.move(4, 4)
    await options.screenshot({ path: `${raw}/${locale}-service.png` })
  }
  finally {
    await context.close()
  }
}

async function exportBoards() {
  const browser = await chromium.launch({ channel: "chromium" })
  try {
    for (const locale of ["zh-CN", "en"]) {
      await mkdir(`${output}/${locale}`, { recursive: true })
      for (let i = 0; i < kinds.length; i++) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
        await page.goto(pathToFileURL(resolve(`design/Store-${slugs[i]}-${locale}.html`)).href)
        await page.evaluate(() => document.fonts.ready)
        assert.ok(await page.locator("img").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), "all board images loaded")
        await page.screenshot({ path: `${output}/${locale}/${slugs[i]}.png`, omitBackground: false })
        await page.close()
      }
    }
    for (const [name, width, height] of [["Small", 440, 280], ["Marquee", 1400, 560]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
      await page.goto(pathToFileURL(resolve(`design/Store-Promo-${name}.html`)).href)
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `${output}/promo-${name.toLowerCase()}.png`, omitBackground: false })
      await page.close()
    }
    await copyFile(resolve("public/icon/128.png"), `${output}/icon-128.png`)
  }
  finally {
    await browser.close()
  }
}

await mkdir(raw, { recursive: true })
await mkdir(output, { recursive: true })
const service = await startDemoService()
try {
  for (const locale of ["zh-CN", "en"])
    await captureLocale(locale, service)
  await exportBoards()
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  await writeFile(`${output}/capture.json`, `${JSON.stringify({ version, sourceCommit, locales: ["zh-CN", "en"], screenshots: slugs, screenshotSize: [1280, 800], permissions: manifest.permissions, hostPermissions: manifest.host_permissions, demo: "Original sample text and deterministic loopback-only service; actual built extension UI", generatedAt: new Date().toISOString() }, null, 2)}\n`)
  process.stdout.write(`Store assets generated for Readomi ${version}: ${output}\n`)
}
finally {
  await service.close()
}
