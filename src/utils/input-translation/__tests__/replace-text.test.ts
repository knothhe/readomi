// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { replaceNativeInput } from "../replace-text"

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
