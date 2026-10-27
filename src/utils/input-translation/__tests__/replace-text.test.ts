// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { INPUT_REPLACE_REQUEST, INPUT_REPLACE_RESPONSE, INPUT_REQUEST_ATTRIBUTE } from "../editable"
import { replaceEditableText, replaceNativeInput } from "../replace-text"

describe("native input replacement", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it.each(["input", "textarea"])("keeps a %s draft and selection intact when translation exceeds maxlength", (tag) => {
    const element = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement
    element.value = "Original  "
    element.maxLength = 12
    document.body.append(element)
    element.focus()
    element.setSelectionRange(3, 5)
    const select = vi.spyOn(element, "select")
    const input = vi.fn()
    element.addEventListener("input", input)

    expect(replaceNativeInput(element, "A much longer translated sentence")).toBe(false)
    expect(element.value).toBe("Original  ")
    expect(element.selectionStart).toBe(3)
    expect(element.selectionEnd).toBe(5)
    expect(select).not.toHaveBeenCalled()
    expect(input).not.toHaveBeenCalled()
  })

  it.each(["input", "textarea"])("allows a %s translation at the exact UTF-16 limit", (tag) => {
    const element = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement
    const text = "Hello 😀"
    element.maxLength = text.length
    element.value = "Draft"
    document.body.append(element)
    element.focus()
    const input = vi.fn()
    element.addEventListener("input", input)

    expect(replaceNativeInput(element, text)).toBe(true)
    expect(element.value).toBe(text)
    expect(input).toHaveBeenCalledOnce()
  })
})

describe("rich input replacement", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("completes and cleans up the editor bridge without crypto.randomUUID on HTTP pages", async () => {
    const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto))
    vi.stubGlobal("crypto", { getRandomValues })
    const element = document.createElement("div")
    element.contentEditable = "true"
    element.textContent = "Original draft"
    document.body.append(element)
    const controller = new AbortController()
    const addMessageListener = vi.spyOn(window, "addEventListener")
    const removeMessageListener = vi.spyOn(window, "removeEventListener")
    const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener")
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      expect(element.getAttribute(INPUT_REQUEST_ATTRIBUTE)).toBe(message.id)
      queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", {
        source: window,
        origin: window.origin,
        data: { type: INPUT_REPLACE_RESPONSE, id: message.id, ok: true },
      })))
    })

    await expect(replaceEditableText(element, "Translated draft", "Original draft", controller.signal)).resolves.toBe(true)

    expect(getRandomValues).toHaveBeenCalledOnce()
    const id = postMessage.mock.calls[0][0].id
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: INPUT_REPLACE_REQUEST, id, text: "Translated draft", expected: "Original draft" }, window.origin)
    expect(element.hasAttribute(INPUT_REQUEST_ATTRIBUTE)).toBe(false)
    const receive = addMessageListener.mock.calls.find(([type]) => type === "message")![1]
    expect(removeMessageListener).toHaveBeenCalledWith("message", receive)
    expect(removeAbortListener).toHaveBeenCalledWith("abort", expect.any(Function))
  })
})
