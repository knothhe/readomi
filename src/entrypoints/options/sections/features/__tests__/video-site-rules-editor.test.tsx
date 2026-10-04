// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import type { VideoSiteRule } from "@/types/config/video-site-rules"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { storageAdapter } from "@/utils/atoms/storage-adapter"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { VideoSiteRulesEditor } from "../video-site-rules-editor"

beforeEach(() => fakeBrowser.reset())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderEditor(videoExcludedSites: VideoSiteRule[] = []) {
  const config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoExcludedSites } }
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  render(<Provider store={store}><VideoSiteRulesEditor /></Provider>)
  return store
}

function input() {
  return screen.getByRole("textbox", { name: "videoSiteRules.ruleLabel" })
}

function add(value: string) {
  fireEvent.change(input(), { target: { value } })
  fireEvent.click(screen.getByRole("button", { name: "videoSiteRules.add" }))
}

function chooseType(type: VideoSiteRule["type"]) {
  fireEvent.click(screen.getByRole("combobox", { name: "videoSiteRules.ruleType" }))
  fireEvent.click(screen.getByRole("option", { name: `videoSiteRules.types.${type}` }))
}

it("adds and removes normalized rules without changing other features", async () => {
  const store = await renderEditor()
  expect(screen.getByText("videoSiteRules.empty")).toBeInTheDocument()
  add(" Example.COM. ")
  await waitFor(() => expect(input()).toHaveValue(""))
  expect(screen.getByText("example.com")).toBeInTheDocument()
  expect(screen.queryByText("videoSiteRules.empty")).not.toBeInTheDocument()
  let stored = await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)
  expect(stored?.features).toEqual({ ...DEFAULT_CONFIG.features, videoExcludedSites: [{ type: "domain", value: "example.com" }] })
  chooseType("pattern")
  add("*.example.org/watch/*")
  await waitFor(() => expect(input()).toHaveValue(""))
  expect(store.get(configAtom).features.videoExcludedSites).toEqual([
    { type: "domain", value: "example.com" },
    { type: "pattern", value: "*://*.example.org/watch/*" },
  ])
  fireEvent.click(screen.getAllByRole("button", { name: "videoSiteRules.remove" })[0]!)
  await waitFor(() => expect(screen.queryByText("example.com")).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole("button", { name: "videoSiteRules.add" })).toBeEnabled())
  stored = await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)
  expect(stored?.features.videoExcludedSites).toEqual([{ type: "pattern", value: "*://*.example.org/watch/*" }])
  expect(stored?.providersConfig).toEqual(DEFAULT_CONFIG.providersConfig)
})

it("prevents an invalid expression and a normalized duplicate from being saved", async () => {
  const store = await renderEditor([{ type: "domain", value: "example.com" }])
  const write = vi.spyOn(storageAdapter, "set")
  add("EXAMPLE.com.")
  expect(screen.getByRole("alert")).toHaveTextContent("videoSiteRules.duplicate")
  expect(input()).toHaveAttribute("aria-invalid", "true")
  expect(input()).toHaveValue("EXAMPLE.com.")
  chooseType("regex")
  add("[example")
  expect(screen.getByRole("alert")).toHaveTextContent("videoSiteRules.invalid")
  expect(input()).toHaveValue("[example")
  expect(write).not.toHaveBeenCalled()
  expect(store.get(configAtom).features.videoExcludedSites).toEqual([{ type: "domain", value: "example.com" }])
})

it("retains the input after a failed save and allows retry", async () => {
  const store = await renderEditor()
  vi.spyOn(storageAdapter, "set").mockRejectedValueOnce(new Error("Write failed"))
  add("school.example.edu")
  expect(await screen.findByRole("alert")).toHaveTextContent("videoSiteRules.saveFailed")
  expect(input()).toHaveValue("school.example.edu")
  expect(input()).not.toHaveAttribute("aria-invalid")
  expect(store.get(configAtom).features.videoExcludedSites).toEqual([])
  expect(screen.getByRole("button", { name: "videoSiteRules.add" })).toBeEnabled()
  fireEvent.click(screen.getByRole("button", { name: "videoSiteRules.add" }))
  await waitFor(() => expect(input()).toHaveValue(""))
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(screen.getByText("school.example.edu")).toBeInTheDocument()
})

it("restores a rule after deletion fails and can retry the delete", async () => {
  const store = await renderEditor([{ type: "domain", value: "example.com" }])
  vi.spyOn(storageAdapter, "set").mockRejectedValueOnce(new Error("Write failed"))
  fireEvent.click(screen.getByRole("button", { name: "videoSiteRules.remove" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("videoSiteRules.saveFailed")
  expect(screen.getByText("example.com")).toBeInTheDocument()
  expect(store.get(configAtom).features.videoExcludedSites).toEqual([{ type: "domain", value: "example.com" }])
  fireEvent.click(screen.getByRole("button", { name: "videoSiteRules.remove" }))
  await waitFor(() => expect(screen.queryByText("example.com")).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole("button", { name: "videoSiteRules.add" })).toBeEnabled())
  expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.videoExcludedSites).toEqual([])
  expect(screen.getByText("videoSiteRules.empty")).toBeInTheDocument()
})

it("shows rules changed in another context while retaining an unfinished draft", async () => {
  const store = await renderEditor()
  fireEvent.change(input(), { target: { value: "unfinished.example.com" } })
  await act(async () => {
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, videoExcludedSites: [{ type: "domain", value: "external.example.com" }] } })
  })
  await waitFor(() => expect(screen.getByText("external.example.com")).toBeInTheDocument())
  expect(input()).toHaveValue("unfinished.example.com")
  expect(store.get(configAtom).features.videoExcludedSites).toEqual([{ type: "domain", value: "external.example.com" }])
  fireEvent.click(screen.getByRole("button", { name: "videoSiteRules.add" }))
  await waitFor(() => expect(input()).toHaveValue(""))
  expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.features.videoExcludedSites).toEqual([
    { type: "domain", value: "external.example.com" },
    { type: "domain", value: "unfinished.example.com" },
  ])
})
