import type { AddressInfo } from "node:net"
import type { ProviderConfig, RequestApi } from "@/types/config/provider"
import { Buffer } from "node:buffer"
import http from "node:http"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { requestTextStream } from "../stream"

let server: http.Server
let origin: string
let answer: (response: http.ServerResponse) => void
let wire: { url?: string, body?: any }
beforeAll(async () => {
  server = http.createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request)
      body += chunk
    wire = { url: request.url, body: JSON.parse(body) }
    answer(response)
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
beforeEach(() => {
  wire = {}
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})
const provider = (api: RequestApi = "openai-chat", body?: Record<string, unknown>): ProviderConfig => ({ id: "p", name: "Test", enabled: true, provider: "openai-compatible", model: "m", api, baseURL: origin, body })
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`
const delta = (content: string) => ({ choices: [{ delta: { content } }] })

describe("provider translation streams", () => {
  it("handles UTF-8, split CRLF, comments and multiline SSE across arbitrary chunks", async () => {
    answer = (response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      const raw = Buffer.from(`: keepalive\r\n\r\n${frame(delta("你好"))}data: {"choices":\r\ndata: [{"delta":{"content":"，世界"}}]}\r\n\r\ndata: [DONE]\r\n\r\n`)
      let index = 0
      const send = () => {
        if (response.destroyed)
          return
        if (index === raw.length) {
          response.end()
          return
        }
        response.write(raw.subarray(index, ++index))
        setTimeout(send, 1)
      }
      send()
    }
    const partials: string[] = []
    await expect(requestTextStream(provider(), { prompt: "P" }, t => partials.push(t))).resolves.toBe("你好，世界")
    expect(partials).toEqual(["你好", "你好，世界"])
    expect(wire.body.stream).toBe(true)
  })
  it.each([
    ["openai-responses", { type: "response.output_text.delta", delta: "你好" }, { type: "response.completed" }, "/responses"],
    ["anthropic", { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } }, { type: "message_stop" }, "/messages"],
    ["gemini", { candidates: [{ content: { parts: [{ thought: true, text: "reasoning" }, { text: "你好" }] } }] }, { candidates: [{ finishReason: "STOP" }] }, "/models/m:streamGenerateContent?alt=sse"],
  ] as const)("reads %s without leaking reasoning", async (api, chunk, done, url) => {
    answer = (response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.end(frame(chunk) + frame(done))
    }
    const partials: string[] = []
    await expect(requestTextStream(provider(api), { prompt: "P" }, t => partials.push(t))).resolves.toBe("你好")
    expect(partials).toEqual(["你好"])
    expect(wire.url).toBe(url)
  })
  it("hides inline thinking tags even when split between events", async () => {
    answer = (response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.end(`${["<th", "ink>secret", "</think>", "你好"].map(t => frame(delta(t))).join("")}data: [DONE]\n\n`)
    }
    const partials: string[] = []
    await expect(requestTextStream(provider(), { prompt: "P" }, t => partials.push(t))).resolves.toBe("你好")
    expect(partials).toEqual(["", "", "", "你好"])
  })
  it("accepts a gateway's JSON fallback and respects stream:false", async () => {
    answer = (response) => {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ choices: [{ message: { content: "你好" } }] }))
    }
    await expect(requestTextStream(provider("openai-chat", { stream: false }), { prompt: "P" }, () => {
      throw new Error("no preview for cached/JSON result")
    })).resolves.toBe("你好")
    expect(wire.body.stream).toBe(false)
  })
  it.each([" \n\t ", "<think>only reasoning</think>"])("rejects a JSON fallback without translation text after cleaning", async (content) => {
    answer = (response) => {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ choices: [{ message: { content } }] }))
    }
    const onPartial = vi.fn()
    await expect(requestTextStream(provider(), { prompt: "P" }, onPartial)).rejects.toThrow("Response has no text")
    expect(onPartial).not.toHaveBeenCalled()
  })
  it.each([frame(delta("half")), frame({ error: { message: "failed" } }), frame({ choices: [{ finish_reason: "length" }] })])("rejects truncated or failed streams instead of committing partial text", async (raw) => {
    answer = (response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.end(raw)
    }
    await expect(requestTextStream(provider(), { prompt: "P" }, () => {})).rejects.toThrow()
  })
  it("aborts a live response and cancels its reader", async () => {
    answer = (response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(frame(delta("partial")))
    }
    const controller = new AbortController()
    await expect(requestTextStream(provider(), { prompt: "P" }, () => controller.abort(), controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })
})
