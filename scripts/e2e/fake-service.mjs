import http from "node:http"

function article(description) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reading and Experience</title>${description ? `<meta name="description" content="${description}">` : ""}</head><body style="max-width:640px;margin:40px auto;font:16px/1.6 Georgia,serif">
<h1>Reading and Experience</h1>
<p>A few months ago I finished a new book, and in reviews I keep noticing words like gripping and explosive. I did not set out to write a gripping book, but that is what happened.</p>
<p>Reading and experience train your model of the world. And even if you forget the experience or what you read, its effect on your model of the world persists.</p>
<p>Your mind is like a compiled program you have lost the source of. It works, but you do not know why.</p>
<p>So what you want to do is to read things that you will be glad to have compiled into your model of the world, even if you do not remember them.</p>
</body></html>`
}

/**
 * How the first message starts in the other requests to the service: the
 * summary prompt (src/utils/content/summary.ts).
 */
export const OTHER_REQUEST_PREFIXES = { summary: "Summarize" }

// These fixed fixtures model language identification in the local API stand-in,
// never in the extension. Unknown legacy English fixtures retain their marker.
export const LANGUAGE_RULES_FIXTURES = {
  design: {
    en: "Good design leaves room for everyday life.",
    zh: "好的设计，为日常生活留出空间。",
  },
  world: {
    en: "Understand the world before expressing yourself.",
    zh: "先读懂世界，再表达自己。",
  },
  curious: {
    en: "Keep reading and stay curious.",
    zh: "继续阅读，保持好奇。",
  },
}

function languageRulesArticle() {
  // Keep the title empty so asynchronous tab-title translation cannot change
  // the context between two otherwise identical cache-policy fixtures.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title></title></head>
<body style="max-width:640px;margin:40px auto;font:16px/1.8 Georgia,serif"><h1>Language rules</h1>
<p id="en-before">${LANGUAGE_RULES_FIXTURES.design.en}</p>
<p id="zh-middle">${LANGUAGE_RULES_FIXTURES.world.zh}</p>
<p id="en-after">${LANGUAGE_RULES_FIXTURES.curious.en}</p></body></html>`
}

function familyForName(name) {
  if (name.includes("Mandarin Chinese"))
    return "zh"
  return name === "English" ? "en" : name
}

function responseSegment(segment, system, withExamples) {
  const original = segment.trim().split("\n").at(-1)
  const primary = system.match(/^Primary language: (.+)\.$/m)?.[1]
  const secondary = system.match(/^Secondary language: (.+)\.$/m)?.[1]
  const entry = Object.values(LANGUAGE_RULES_FIXTURES).find(item => original.includes(item.zh) || original.includes(item.en))
  const sourceFamily = entry && original.includes(entry.zh) ? "zh" : "en"
  const route = primary && sourceFamily === familyForName(primary)
    ? system.includes("preserve the original: output only [[readomi:preserve]]") ? "preserve" : "secondary"
    : "primary"
  const targetFamily = familyForName(route === "secondary" ? secondary ?? "" : primary ?? "")
  const text = withExamples && entry && entry[targetFamily]
    ? entry[targetFamily]
    : `【译】${original.slice(0, 24)}`
  return {
    route,
    header: primary ? `[[readomi:${route}]]` : "",
    text: route === "preserve" ? "" : text,
  }
}

/**
 * A local stand-in for an OpenAI-compatible service, plus an English article
 * to translate at `/article` (`?description=` adds a meta description).
 * `POST /v1/chat/completions` splits the last user message at the standalone
 * `%%` lines and answers each part with "【译】" and the first 24 characters
 * of the part's last line, keeping the batch separators Readomi uses, so a
 * translated page is easy to recognize. Automatic-language requests also
 * receive their per-segment protocol header; fixed Chinese fixtures select
 * the secondary or preserve route. `languageRules` enables real bilingual
 * examples for the language-policy integration case. The model "rejected-model" gets a
 * 400 answer, like a service that does not know the model.
 * Every API request is recorded in `requests` for assertions; `messages()`
 * and `translationRequests()` give the messages of the recorded requests.
 * Article navigation requests are recorded separately in `articleRequests`.
 * `holdAnswers()` keeps the answers back until the function it returns is
 * called, like a slow service.
 */
export async function startFakeService({ streaming = false, languageRules = false, subtitleInlineHeaders = false, subtitleBatchResponse } = {}) {
  const requests = []
  const articleRequests = []
  let heldStreamCompletion
  let heldAnswers
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost")
    if (request.method === "GET" && url.pathname === "/language-rules") {
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      response.end(languageRulesArticle())
      return
    }
    if (request.method === "GET" && url.pathname === "/grid-contents") {
      // Earendil's email metadata uses these layout rules: p boxes disappear
      // and their key/value children occupy separate grid columns.
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reading and Experience</title><style>
body{max-width:560px;margin:40px auto;font:16px/1.5 monospace}
.email-meta{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:1ch;align-items:baseline;margin-bottom:24px}
.email-meta p{display:contents}.key,.value{min-width:0;line-height:1.5}.value{overflow-wrap:anywhere}
</style></head><body><article><h1>Reading and Experience</h1><div class="email-meta">
<p><span class="key">Date:</span><time class="value" datetime="2026-09-29">Tue, 29 Sept 2026</time></p>
<p><span class="key">From:</span><span class="value">Reading Team &lt;<a href="mailto:hello@example.com">hello@example.com</a>&gt;</span></p>
<p><span class="key">To:</span><span class="value">You</span></p>
<p><span class="key">Subject:</span><span class="value">Reading and Experience</span></p>
</div><div class="prose"><p>Reading keeps changing the way we understand the world. A <a href="https://example.com/">linked note</a> can lead us to a new idea.</p><h2>Keep reading</h2></div></article></body></html>`)
      return
    }
    if (request.method === "GET" && url.pathname === "/article") {
      articleRequests.push({ method: request.method, url: request.url, userAgent: request.headers["user-agent"] })
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      response.end(article(url.searchParams.get("description")))
      return
    }
    let body = ""
    for await (const chunk of request)
      body += chunk
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, userAgent: request.headers["user-agent"], body })
    await heldAnswers
    if (request.method === "GET" && request.url === "/v1/models") {
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify({ data: [{ id: "fake-model" }, { id: "second-model" }] }))
      return
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const json = JSON.parse(body)
      if (json.model === "rejected-model") {
        response.statusCode = 400
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify({ error: { message: "The model rejected-model does not exist" } }))
        return
      }
      const user = [...json.messages].reverse().find(message => message.role === "user")?.content ?? ""
      const system = json.messages.filter(message => message.role === "system").map(message => message.content).join("\n")
      // Interpret the wire envelope, then translate source segments only.
      const source = user.match(/<(readomi_source_\d+)>\n([\s\S]*)\n<\/\1>/)?.[2] ?? user
      const segments = source
        .split(/\r?\n[ \t]*%%[ \t]*\r?\n/)
        .map(segment => responseSegment(segment, system, languageRules))
      let translated = segments
        .map(({ header, text }) => header ? `${header}${text ? `\n${text}` : ""}` : text)
        .join("\n%%\n")
      if (system.includes("## Subtitle Batch Response Contract")) {
        const items = JSON.parse(user.split("Requested subtitle IDs and read-only context:\n").at(-1))
        const outcomes = items.map((item) => {
          const { header, text } = responseSegment(item.text, system, languageRules)
          return { id: item.id, translation: header ? `${header}${text ? `${subtitleInlineHeaders ? "" : "\n"}${text}` : ""}` : text }
        })
        translated = JSON.stringify(subtitleBatchResponse ? await subtitleBatchResponse(items, outcomes) : outcomes)
      }
      if (streaming && json.stream) {
        response.setHeader("Content-Type", "text/event-stream")
        // Keep legacy long-stream typography coverage, including deliberately
        // fragmented route headers. Preserve responses have no translated body.
        const segment = segments[0]
        const legacyText = "阅读和经历训练的是你对世界的模型。每一个新想法，都会成为你理解接下来发生的事情的一部分。".repeat(6)
        const text = segment.route === "preserve"
          ? segment.header
          : `${segment.header ? `${segment.header}\n` : ""}${languageRules ? segment.text : legacyText}`
        for (let index = 0; index < text.length && !response.destroyed; index += 8) {
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(index, index + 8) } }] })}\n\n`)
          await new Promise(resolve => setTimeout(resolve, 30))
        }
        await heldStreamCompletion
        response.end("data: [DONE]\n\n")
        return
      }
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify({
        id: "chatcmpl-e2e",
        object: "chat.completion",
        created: 1,
        model: json.model,
        choices: [{ index: 0, message: { role: "assistant", content: translated }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: { message: `no route ${request.method} ${request.url}` } }))
  })
  // Port 0 asks the OS for a free port; Chromium refuses a few well-known ports, which the OS never hands out here.
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const completions = () => requests.filter(request => request.url === "/v1/chat/completions")
  const messages = () => completions().map(({ body }) => JSON.parse(body).messages)
  const otherPrefixes = Object.values(OTHER_REQUEST_PREFIXES)
  return {
    origin,
    requests,
    articleRequests,
    completions,
    messages,
    translationRequests: () => messages().filter(([message]) => !otherPrefixes.some(prefix => message.content.startsWith(prefix))),
    holdStreamCompletion() {
      let release
      heldStreamCompletion = new Promise(resolve => release = resolve)
      return () => {
        heldStreamCompletion = undefined
        release()
      }
    },
    holdAnswers() {
      let release
      heldAnswers = new Promise(resolve => release = resolve)
      return () => {
        heldAnswers = undefined
        release()
      }
    },
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/** A setup document that points Readomi at the fake service. It describes the service only. */
export function setupDocumentFor(origin, overrides = {}) {
  return {
    type: "openai-compatible",
    name: "Local gateway",
    apiKey: "local-secret-key",
    model: "fake-model",
    baseURL: `${origin}/v1/`,
    ...overrides,
  }
}
