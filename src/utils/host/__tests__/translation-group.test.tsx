// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { PageTranslationRequest } from "@/utils/host/translate/stream-request"
import { act } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { BLOCK_CONTENT_CLASS, CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"
import { flushBatchedOperations } from "@/utils/host/dom/batch-dom"
import { walkAndLabelElement } from "@/utils/host/dom/traversal"
import { removeTranslatedWrapperWithRestore } from "@/utils/host/translate/dom/translation-cleanup"
import { translateWalkedElement } from "@/utils/host/translate/node-manipulation"
import { translateTextForPage } from "@/utils/host/translate/translate-variants"

const translated = "翻译后的标题。\n\n翻译后的第一段。\n\n翻译后的第二段。"
vi.mock("@/utils/host/translate/translate-variants", () => ({ translateTextForPage: vi.fn(() => Promise.resolve(translated)) }))

function setup(mode: Config["translate"]["mode"] = "bilingual") {
  document.body.innerHTML = `<post-card id="source">
    <h2 slot="title">Read the complete source title.</h2>
    <div slot="text-body"><p>The first source paragraph has a <a href="https://example.com/">link</a>.</p><p>The second source paragraph stays separate.</p></div>
    <div id="media">Image description</div><button>Vote and share</button>
  </post-card>`
  const config: Config = {
    ...DEFAULT_CONFIG,
    translate: { ...DEFAULT_CONFIG.translate, mode },
    siteRules: {
      disabledBuiltInRules: [],
      userRules: [{
        id: "group-test",
        matches: "*",
        translationGroups: [{ containerSelector: "post-card", sourceSelectors: [":scope > [slot='title']", ":scope > [slot='text-body']"], slot: "text-body" }],
      }],
    },
  }
  return { config, root: document.getElementById("source")! }
}

async function translate(root: HTMLElement, config: Config, request?: PageTranslationRequest) {
  const walkId = crypto.randomUUID()
  walkAndLabelElement(root, walkId, config)
  await act(async () => {
    await translateWalkedElement(root, walkId, config, false, undefined, request)
    flushBatchedOperations()
  })
}

afterEach(() => {
  for (const wrapper of document.querySelectorAll<HTMLElement>(`.${CONTENT_WRAPPER_CLASS}`))
    removeTranslatedWrapperWithRestore(wrapper)
  flushBatchedOperations()
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe("declared translation groups", () => {
  it("requests only the ordered source paragraphs once and displays the result in its named slot", async () => {
    const { root, config } = setup()
    await translate(root, config)

    expect(translateTextForPage).toHaveBeenCalledOnce()
    expect(translateTextForPage).toHaveBeenCalledWith(
      "Read the complete source title.\n\nThe first source paragraph has a link.\n\nThe second source paragraph stays separate.",
      expect.objectContaining({ onTargetLanguage: expect.any(Function) }),
    )
    const wrappers = root.querySelectorAll<HTMLElement>(`.${CONTENT_WRAPPER_CLASS}`)
    expect(wrappers).toHaveLength(1)
    expect(wrappers[0].parentElement).toBe(root)
    expect(wrappers[0]).toHaveAttribute("slot", "text-body")
    expect(wrappers[0].firstElementChild).toHaveClass(BLOCK_CONTENT_CLASS)
    expect(wrappers[0].querySelector<HTMLElement>(`.${BLOCK_CONTENT_CLASS}`)!.style.whiteSpace).toBe("pre-wrap")
    expect(wrappers[0].textContent).toBe(translated)
    expect(document.getElementById("media")).toHaveTextContent("Image description")
    expect(root.querySelector("button")).toHaveTextContent("Vote and share")
  })

  it("hides only its live readable sources and restores their nodes and links in translation-only mode", async () => {
    const { root, config } = setup("translationOnly")
    const sources = [...root.querySelectorAll<HTMLElement>(":scope > [slot]")]
    const link = root.querySelector("a")!
    const click = vi.fn((event: Event) => event.preventDefault())
    link.addEventListener("click", click)
    await translate(root, config)

    expect(sources.every(source => source.isConnected && source.style.display === "none")).toBe(true)
    expect(document.getElementById("media")!.style.display).not.toBe("none")
    expect(root.querySelector("button")!.style.display).not.toBe("none")
    const wrapper = root.querySelector<HTMLElement>(`.${CONTENT_WRAPPER_CLASS}`)!
    removeTranslatedWrapperWithRestore(wrapper)
    flushBatchedOperations()

    expect([...root.querySelectorAll(":scope > [slot]")]).toEqual(sources)
    expect(sources.every(source => source.style.display === "")).toBe(true)
    expect(root.querySelector("a")).toBe(link)
    link.dispatchEvent(new MouseEvent("click", { cancelable: true }))
    expect(click).toHaveBeenCalledOnce()
    expect(root.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
  })

  it("cancels a pending group when its source changes and leaves the updated source readable", async () => {
    const { root, config } = setup()
    let complete!: (text: string) => void
    const cancel = vi.fn()
    const request: PageTranslationRequest = Object.assign(vi.fn(() => new Promise<string>(resolve => complete = resolve)), { cancel })
    const pending = translate(root, config, request)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    flushBatchedOperations()
    root.querySelector("h2")!.textContent = "The source title was updated by the website."
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    complete(translated)
    await pending

    expect(root.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    expect(root.querySelector("h2")).toHaveTextContent("The source title was updated by the website.")
    expect(root.querySelector("h2")!.style.display).not.toBe("none")
    expect(root.textContent).not.toContain(translated)
  })
})
