// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest"
import { TRANSLATION_FONT_FAMILIES } from "@/types/config/translation-font"
import { PAGE_TRANSLATION_FONT_VARIABLE } from "@/utils/host-translation-font"
import { ensurePresetStyles } from "@/utils/host/translate/ui/style-injector"
import { configWithMode, setUpHostContentTests, storeConfig } from "./host-content-harness"

const hostContent = setUpHostContentTests()

beforeEach(() => {
  document.body.innerHTML = "<p id=\"passage\">Reading and experience train your model of the world.</p>"
})

it.each(["bilingual", "translationOnly"] as const)("restyles existing and future shadow translations in %s without replacing the translation", async (mode) => {
  const config = configWithMode(mode)
  await storeConfig(config)
  await hostContent.start()
  await vi.waitFor(() => expect(document.querySelector("#passage")?.textContent).toContain("translated: "))
  const wrapper = document.querySelector("[data-readomi-translation-mode]")
  const shadowHost = document.createElement("div")
  document.body.append(shadowHost)
  const shadow = shadowHost.attachShadow({ mode: "open" })
  ensurePresetStyles(shadow)
  const textBefore = document.querySelector("#passage")!.textContent
  const statesBefore = hostContent.stateMessages.length

  await storeConfig({ ...config, translate: { ...config.translate, translationFont: "serif" } })
  await vi.waitFor(() => expect(document.documentElement.style.getPropertyValue(PAGE_TRANSLATION_FONT_VARIABLE)).toBe(TRANSLATION_FONT_FAMILIES.serif))
  expect(shadowHost.style.getPropertyValue(PAGE_TRANSLATION_FONT_VARIABLE)).toBe(TRANSLATION_FONT_FAMILIES.serif)
  expect(document.querySelector("[data-readomi-translation-mode]")).toBe(wrapper)
  expect(document.querySelector("#passage")!.textContent).toBe(textBefore)
  expect(hostContent.stateMessages).toHaveLength(statesBefore)

  const laterHost = document.createElement("div")
  document.body.append(laterHost)
  ensurePresetStyles(laterHost.attachShadow({ mode: "open" }))
  expect(laterHost.style.getPropertyValue(PAGE_TRANSLATION_FONT_VARIABLE)).toBe(TRANSLATION_FONT_FAMILIES.serif)

  await storeConfig(config)
  await vi.waitFor(() => expect(shadowHost.style.getPropertyValue(PAGE_TRANSLATION_FONT_VARIABLE)).toBe(TRANSLATION_FONT_FAMILIES.sans))
  expect(document.querySelector("[data-readomi-translation-mode]")).toBe(wrapper)
})
