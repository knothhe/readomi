// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { clearTranslationLayouts, LAYOUT_OWNER_ATTRIBUTE, releaseDetachedTranslationLayouts, releaseTranslationLayout, retainTranslationLayout } from "../translation-layout-ownership"

function wrapper(parent: HTMLElement) {
  const node = document.createElement("span")
  node.className = CONTENT_WRAPPER_CLASS
  parent.append(node)
  return node
}

afterEach(() => {
  clearTranslationLayouts()
  document.body.replaceChildren()
})

describe("translation layout ownership", () => {
  it("shares an owner across two results without marking their shared page container", () => {
    document.body.innerHTML = "<section id='shared'><p id='source'><span>Source text</span></p><p id='untouched'>Another paragraph</p></section>"
    const source = document.getElementById("source")!
    const first = wrapper(source)
    const second = wrapper(source)
    retainTranslationLayout(first, [source])
    retainTranslationLayout(second, [source])
    expect(source).toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE, "true")
    expect(document.getElementById("shared")).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    expect(document.getElementById("untouched")).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    releaseTranslationLayout(first)
    expect(source).toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    releaseTranslationLayout(second)
    expect(source).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
  })

  it("restores a previous marker and preserves source styles and host changes", () => {
    document.body.innerHTML = "<p style='max-height:48px!important' data-readomi-layout-owner='host'>Source text</p>"
    const source = document.querySelector("p")!
    const result = wrapper(source)
    retainTranslationLayout(result, [source])
    source.style.setProperty("max-height", "72px", "important")
    releaseTranslationLayout(result)
    expect(source).toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE, "host")
    expect(source.style.maxHeight).toBe("72px")
    expect(source.style.getPropertyPriority("max-height")).toBe("important")
    retainTranslationLayout(result, [source])
    source.setAttribute(LAYOUT_OWNER_ATTRIBUTE, "host-updated")
    releaseTranslationLayout(result)
    expect(source).toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE, "host-updated")
  })

  it("releases wrappers removed by the host and never claims document shell elements", () => {
    document.body.innerHTML = "<p>Source text</p>"
    const source = document.querySelector("p")!
    const result = wrapper(source)
    retainTranslationLayout(result, [source, document.body, document.documentElement])
    expect(document.body).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    expect(document.documentElement).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    result.remove()
    releaseDetachedTranslationLayouts()
    expect(source).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    releaseTranslationLayout(result)
  })

  it("does not claim a pending detached wrapper", () => {
    const source = document.createElement("p")
    document.body.append(source)
    retainTranslationLayout(document.createElement("span"), [source])
    expect(source).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
  })

  it("does not claim a shared parent when a group places its result after the source", () => {
    document.body.innerHTML = "<section><article>First card</article><article>Untouched card</article></section>"
    const parent = document.querySelector("section")!
    const source = parent.querySelector("article")!
    const result = wrapper(parent)
    retainTranslationLayout(result, [source])
    expect(source).toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    expect(parent).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    expect(parent.lastElementChild).toBe(result)
  })

  it("repairs a single-child clipped card shell without claiming the surrounding card grid", () => {
    document.body.innerHTML = "<main><article id='card'><div><p id='source'>Source text</p></div></article><article>Untouched card</article></main>"
    const source = document.getElementById("source")!
    const result = wrapper(source)
    retainTranslationLayout(result, [source])
    expect(document.getElementById("card")).toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    expect(document.querySelector("main")).not.toHaveAttribute(LAYOUT_OWNER_ATTRIBUTE)
    releaseTranslationLayout(result)
    expect(document.querySelector(`[${LAYOUT_OWNER_ATTRIBUTE}]`)).toBeNull()
  })
})
