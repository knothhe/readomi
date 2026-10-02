import type { TextRequest } from "./request"
import type { ProviderConfig, RequestApi } from "@/types/config/provider"
import { describeErrorBody } from "@/utils/error/extract-message"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { extractResponseText, prepareRequest, ProviderRequestError, resolveRequestApi } from "./request"

/** Never expose inline reasoning, including a tag split across network chunks. */
export function translationFromStream(text: string): string {
  const trimmed = text.trimStart()
  if ("<think>".startsWith(trimmed) || trimmed.startsWith("<think>")) {
    const end = text.indexOf("</think>")
    return end < 0 ? "" : text.slice(end + 8).trimStart()
  }
  return text
}

function readEvent(api: RequestApi, value: any): { delta?: string, complete?: boolean } {
  if (value.error || value.type === "error" || value.type === "response.failed" || value.type === "response.incomplete")
    throw new Error(describeErrorBody(JSON.stringify(value), "Translation stream failed"))
  switch (api) {
    case "openai-chat": {
      const choice = value.choices?.[0]
      if (choice?.finish_reason === "length" || choice?.finish_reason === "content_filter")
        throw new Error(`Translation stopped: ${choice.finish_reason}`)
      return { delta: choice?.delta?.content }
    }
    case "openai-responses":
      return { delta: value.type === "response.output_text.delta" ? value.delta : undefined, complete: value.type === "response.completed" }
    case "anthropic":
      if (value.delta?.stop_reason === "max_tokens")
        throw new Error("Translation stopped: max_tokens")
      return { delta: value.delta?.type === "text_delta" ? value.delta.text : undefined, complete: value.type === "message_stop" }
    case "gemini": {
      const candidate = value.candidates?.[0]
      if (candidate?.finishReason && candidate.finishReason !== "STOP")
        throw new Error(`Translation stopped: ${candidate.finishReason}`)
      return {
        delta: candidate?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text ?? "").join(""),
        complete: candidate?.finishReason === "STOP",
      }
    }
  }
}

/** SSE framing is independent of fetch chunks (UTF-8, CRLF and multiline data). */
export async function requestTextStream(
  provider: ProviderConfig,
  request: TextRequest,
  onPartial: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const api = resolveRequestApi(provider)
  const prepared = prepareRequest(provider, request)
  // An explicit stream:false stays authoritative for incompatible gateways.
  const streaming = api === "gemini" || prepared.body.stream !== false
  const url = api === "gemini"
    ? prepared.url.replace(/:generateContent$/, ":streamGenerateContent?alt=sse")
    : prepared.url
  const response = await fetch(url, {
    method: "POST",
    headers: prepared.headers,
    body: JSON.stringify(api === "gemini" ? prepared.body : { ...prepared.body, stream: streaming }),
    signal,
  })
  if (!response.ok) {
    const body = await response.text()
    const headers = Object.fromEntries(response.headers.entries())
    throw attachRequestErrorMeta(new ProviderRequestError(describeErrorBody(body, `${response.status} ${response.statusText}`.trim()), url, response.status, headers, body), { statusCode: response.status, responseHeaders: headers })
  }
  // Gateways can answer a streaming request with their ordinary JSON response.
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const text = extractResponseText(api, await response.json())
    const result = text ? translationFromStream(text).trim() : ""
    if (!result)
      throw new ProviderRequestError("Response has no text", url, response.status)
    return result
  }
  if (!response.body)
    throw new ProviderRequestError("Response has no stream", url, response.status)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let text = ""
  let complete = false
  const event = (frame: string) => {
    const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n")
    if (!data)
      return
    if (data.trim() === "[DONE]") {
      complete = true
      return
    }
    const result = readEvent(api, JSON.parse(data))
    complete ||= !!result.complete
    if (typeof result.delta === "string") {
      text += result.delta
      onPartial(translationFromStream(text))
    }
  }
  try {
    while (true) {
      if (complete)
        break
      signal?.throwIfAborted()
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      // Normalize CRLF only after its LF arrives, even across fetch chunks.
      buffer = buffer.replace(/\r\n/g, "\n")
      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        event(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")
      }
      if (chunk.done) {
        if (buffer.trim())
          event(buffer)
        break
      }
    }
    signal?.throwIfAborted()
    if (!complete)
      throw new ProviderRequestError("Translation stream ended before completion", url)
    const result = translationFromStream(text).trim()
    if (!result)
      throw new ProviderRequestError("Translation stream has no text", url)
    return result
  }
  catch (error) {
    // A half response must not be retried or presented as a finished translation.
    // Abort also stops queued retries after the preview is dismissed.
    if (text || signal?.aborted)
      throw attachRequestErrorMeta(error instanceof Error ? error : new Error(String(error)), { isRetryable: false })
    throw error
  }
  finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
