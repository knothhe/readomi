// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BLOCK_CONTENT_CLASS, CONTENT_WRAPPER_CLASS, INLINE_CONTENT_CLASS } from "@/utils/constants/dom-labels"
import { flushBatchedOperations } from "@/utils/host/dom/batch-dom"
import { walkAndLabelElement } from "@/utils/host/dom/traversal"
import { translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { translateTextForPage } from "@/utils/host/translate/translate-variants"

const translatedText = "他拿着那台 FX3 的样子"

vi.mock("@/utils/host/translate/translate-variants", () => ({
  translateTextForPage: vi.fn(() => Promise.resolve("他拿着那台 FX3 的样子")),
}))

const originalLocation = window.location

function setHost(host: string) {
  Object.defineProperty(window, "location", {
    value: new URL(`https://${host}/some/status`),
    writable: true,
    configurable: true,
  })
}

function configFor(preset: "blockquote" | "line" = "blockquote", mode: "bilingual" | "translationOnly" = "bilingual"): Config {
  return {
    ...DEFAULT_CONFIG,
    translate: {
      ...DEFAULT_CONFIG.translate,
      mode,
      translationNodeStyle: { ...DEFAULT_CONFIG.translate.translationNodeStyle, preset },
    },
  }
}

async function translate(config: Config, toggle = false) {
  const walkId = crypto.randomUUID()
  walkAndLabelElement(document.body, walkId, config)
  await act(async () => {
    await translateWalkedElement(document.body, walkId, config, toggle)
    flushBatchedOperations()
  })
}

describe("x tweet translation", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ""
    Object.defineProperty(window, "location", { value: originalLocation, writable: true, configurable: true })
  })

  it.each(["x.com", "twitter.com"])("keeps a single-span tweet separate and follows the selected style on %s", async (host) => {
    setHost(host)
    render(<div data-testid="tweetText"><span style={{ display: "inline" }}>how bro was holding that fx3</span></div>)
    const tweet = screen.getByTestId("tweetText")
    const source = tweet.firstChild
    const config = configFor()

    await translate(config, true)

    const wrapper = tweet.querySelector(`.${CONTENT_WRAPPER_CLASS}`)!
    const translation = wrapper.querySelector(`.${BLOCK_CONTENT_CLASS}`)!
    expect(wrapper.parentElement).toBe(tweet)
    expect(translation).toHaveTextContent(translatedText)
    expect(translation).toHaveAttribute("data-readomi-custom-translation-style", "blockquote")
    expect(wrapper.firstChild?.nodeName).toBe("BR")
    expect(tweet.querySelector(`.${INLINE_CONTENT_CLASS}`)).toBeNull()
    expect(translateTextForPage).toHaveBeenCalledTimes(1)

    await translate(config, true)

    expect(tweet.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    expect(tweet.firstChild).toBe(source)
    expect(tweet.textContent).toBe("how bro was holding that fx3")
  })

  it("translates mixed spans, links and preserved newlines once without splitting their paragraph", async () => {
    setHost("x.com")
    render(
      <div data-testid="tweetText">
        <span style={{ display: "inline" }}>Read this </span>
        <a href="https://example.com/" style={{ display: "inline" }}>linked note</a>
        <span style={{ display: "inline" }}>{" before\nwatching the video."}</span>
      </div>,
    )
    const tweet = screen.getByTestId("tweetText")
    const sourceNodes = [...tweet.childNodes]
    const link = tweet.querySelector("a")!
    const click = vi.fn((event: Event) => event.preventDefault())
    link.addEventListener("click", click)
    const config = configFor("line")

    await translate(config, true)

    expect(translateTextForPage).toHaveBeenCalledTimes(1)
    expect(translateTextForPage).toHaveBeenCalledWith("Read this linked note before\nwatching the video.", expect.objectContaining({ onTargetLanguage: expect.any(Function) }))
    expect(tweet.querySelectorAll(`.${CONTENT_WRAPPER_CLASS}`)).toHaveLength(1)
    expect(tweet.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toHaveAttribute("data-readomi-custom-translation-style", "line")

    await translate(config, true)

    expect([...tweet.childNodes]).toEqual(sourceNodes)
    expect(tweet.querySelector("a")).toBe(link)
    link.dispatchEvent(new MouseEvent("click", { cancelable: true }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it("keeps the existing inline behavior for the same markup on other sites", async () => {
    setHost("example.com")
    render(<div data-testid="tweetText"><span style={{ display: "inline" }}>how bro was holding that fx3</span></div>)
    const tweet = screen.getByTestId("tweetText")

    await translate(configFor())

    const wrapper = tweet.querySelector(`.${CONTENT_WRAPPER_CLASS}`)!
    expect(wrapper.parentElement).toBe(tweet.querySelector("span"))
    expect(wrapper.querySelector(`.${INLINE_CONTENT_CLASS}`)).toHaveTextContent(translatedText)
    expect(wrapper.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toBeNull()
  })

  it.each([
    { host: "x.com", markup: "<div id='target' data-testid='tweetText' style='display:block;max-height:48px;text-overflow:ellipsis'><span id='inner' style='display:inline;max-height:24px;text-overflow:ellipsis'>how bro was holding that fx3</span></div>" },
    { host: "www.youtube.com", markup: "<yt-attributed-string style='display:block'><span id='target' style='display:inline;max-height:48px;text-overflow:ellipsis'><span id='inner' style='display:inline;max-height:24px;text-overflow:ellipsis'>A comment about the video.</span></span></yt-attributed-string>" },
  ])("still releases truncation while keeping the explicit paragraph on $host", async ({ host, markup }) => {
    setHost(host)
    const idleTasks: (() => void)[] = []
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      idleTasks.push(callback)
      return idleTasks.length
    })
    document.body.innerHTML = markup
    const target = document.getElementById("target")!
    const inner = document.getElementById("inner")!

    await translate(configFor())

    expect(target.style.maxHeight).toBe("48px")
    expect(inner.style.maxHeight).toBe("24px")
    idleTasks.forEach(task => task())
    expect(target.style.maxHeight).toBe("unset")
    expect(inner.style.maxHeight).toBe("unset")
    expect(target.style.textOverflow).toBe("unset")
    expect(inner.style.textOverflow).toBe("unset")
    expect(target.querySelector(`.${CONTENT_WRAPPER_CLASS}`)?.parentElement).toBe(target)
    expect(target.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toHaveTextContent(translatedText)
  })

  it("keeps translation-only replacement and restoration working", async () => {
    setHost("x.com")
    render(<div data-testid="tweetText"><span style={{ display: "inline" }}>how bro was holding that fx3</span></div>)
    const tweet = screen.getByTestId("tweetText")
    const config = configFor("blockquote", "translationOnly")

    await translate(config, true)
    expect(tweet).toHaveTextContent(translatedText)
    expect(tweet.querySelector(`.${BLOCK_CONTENT_CLASS}`)).toBeNull()

    await translate(config, true)
    expect(tweet.textContent).toBe("how bro was holding that fx3")
    expect(tweet.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
  })
})
