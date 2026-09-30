// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BLOCK_ATTRIBUTE, PARAGRAPH_ATTRIBUTE } from "@/utils/constants/dom-labels"
import { extractTextContent, walkAndLabelElement } from "../traversal"

describe("walkAndLabelElement", () => {
  it("keeps display contents rows from combining separate grid cells into one paragraph", () => {
    const grid = document.createElement("div")
    grid.style.display = "grid"
    // Grid items are blockified by the browser; jsdom needs explicit display.
    grid.innerHTML = `<p style="display:contents"><span style="display:block">From:</span><span style="display:block">Reading Team</span></p>
      <p style="display:contents"><span style="display:block">To:</span><span style="display:block">You</span></p>`

    walkAndLabelElement(grid, "grid-test", DEFAULT_CONFIG)

    expect(grid.hasAttribute(PARAGRAPH_ATTRIBUTE)).toBe(false)
    for (const row of grid.children) {
      expect(row.hasAttribute(BLOCK_ATTRIBUTE)).toBe(true)
      expect(row.hasAttribute(PARAGRAPH_ATTRIBUTE)).toBe(false)
      for (const cell of row.children)
        expect(cell.hasAttribute(PARAGRAPH_ATTRIBUTE)).toBe(true)
    }
  })
})

describe("extractTextContent", () => {
  describe("text node whitespace normalization", () => {
    it("should return trimmed text without spaces when only newlines are trimmed", () => {
      const textNode = document.createTextNode("\n\nHello\n\n")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe("Hello")
    })

    it("should add leading space when leading whitespace contains spaces", () => {
      const textNode = document.createTextNode("  Hello")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe(" Hello")
    })

    it("should add trailing space when trailing whitespace contains spaces", () => {
      const textNode = document.createTextNode("Hello  ")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe("Hello ")
    })

    it("should add both spaces when both sides have non-newline whitespace", () => {
      const textNode = document.createTextNode("  Hello  ")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe(" Hello ")
    })

    it("should add spaces when whitespace includes both newlines and spaces", () => {
      const textNode = document.createTextNode("\n  Hello  \n")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe(" Hello ")
    })

    it("should add leading space when leading has newline then space", () => {
      const textNode = document.createTextNode("\n Hello")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe(" Hello")
    })

    it("should add trailing space when trailing has space then newline", () => {
      const textNode = document.createTextNode("Hello \n")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe("Hello ")
    })

    it("should not add spaces for text without any whitespace", () => {
      const textNode = document.createTextNode("Hello")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe("Hello")
    })

    it("should return single space for whitespace-only text", () => {
      const textNode = document.createTextNode("   ")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe(" ")
    })

    it("should return single space for newline-only text", () => {
      const textNode = document.createTextNode("\n\n")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe(" ")
    })

    it("should return single space for empty text", () => {
      const textNode = document.createTextNode("")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe(" ")
    })

    it("should handle tabs as non-newline whitespace", () => {
      const textNode = document.createTextNode("\tHello\t")
      expect(extractTextContent(textNode, DEFAULT_CONFIG)).toBe(" Hello ")
    })
  })

  describe("br element handling", () => {
    it("should return newline for BR element", () => {
      const br = document.createElement("br")
      expect(extractTextContent(br, DEFAULT_CONFIG)).toBe("\n")
    })
  })

  describe("nested element extraction", () => {
    it("should extract text from nested elements", () => {
      const div = document.createElement("div")
      div.innerHTML = "Hello <span>World</span>"
      expect(extractTextContent(div, DEFAULT_CONFIG)).toBe("Hello World")
    })

    it("should handle BR in nested content", () => {
      const div = document.createElement("div")
      div.innerHTML = "Line1<br>Line2"
      expect(extractTextContent(div, DEFAULT_CONFIG)).toBe("Line1\nLine2")
    })

    it("should preserve spaces between inline elements", () => {
      const div = document.createElement("div")
      div.innerHTML = "<span>Hello</span> <span>World</span>"
      expect(extractTextContent(div, DEFAULT_CONFIG)).toBe("Hello World")
    })

    it("should include ruby text and exclude rp/rt elements", () => {
      const div = document.createElement("div")
      div.innerHTML = "Before<ruby>大阪<rp>(</rp><rt>Osaka</rt><rp>)</rp></ruby>After"
      expect(extractTextContent(div, DEFAULT_CONFIG)).toBe("Before大阪After")
    })
  })

  describe("visually hidden element exclusion", () => {
    it("should exclude sr-only child element text", () => {
      const div = document.createElement("div")
      div.innerHTML = "Visible text<span class=\"sr-only\">Hidden text</span>"
      expect(extractTextContent(div, DEFAULT_CONFIG)).toBe("Visible text")
    })

    it("should exclude visually-hidden child element text", () => {
      const div = document.createElement("div")
      div.innerHTML = "Visible text<span class=\"visually-hidden\">Hidden text</span>"
      expect(extractTextContent(div, DEFAULT_CONFIG)).toBe("Visible text")
    })

    it("should exclude sr-only text mixed with visible siblings", () => {
      const div = document.createElement("div")
      div.innerHTML = "<span>Hello</span><span class=\"sr-only\">Secret</span> <span>World</span>"
      expect(extractTextContent(div, DEFAULT_CONFIG)).toBe("Hello World")
    })
  })
})
