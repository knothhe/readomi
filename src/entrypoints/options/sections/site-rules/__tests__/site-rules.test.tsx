// @vitest-environment jsdom
import type { Config } from "@/types/config/config"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { storageAdapter } from "@/utils/atoms/storage-adapter"
import { copyText } from "@/utils/clipboard"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { SiteRulesSection } from ".."

vi.mock("@/utils/clipboard", () => ({ copyText: vi.fn() }))

beforeEach(() => {
  fakeBrowser.reset()
  vi.mocked(copyText).mockResolvedValue(true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderRules(siteRules = DEFAULT_CONFIG.siteRules) {
  const config = { ...DEFAULT_CONFIG, siteRules }
  await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, config)
  const store = createStore()
  store.set(configAtom, config)
  render(<Provider store={store}><SiteRulesSection /></Provider>)
  return store
}

function openAdvancedEditor() {
  const panel = screen.getByRole("tabpanel", { name: "siteRules.custom" })
  const summary = within(panel).getByText("siteRuleAgent.more", { selector: "summary" })
  if (!summary.closest("details")?.open)
    fireEvent.click(summary)
  expect(summary.closest("details")).toHaveAttribute("open")
  fireEvent.click(within(panel).getByRole("button", { name: "siteRuleAgent.advanced" }))
  return screen.getByRole("textbox", { name: "siteRules.editorLabel" })
}

function openEditor() {
  fireEvent.click(screen.getByRole("tab", { name: "siteRules.custom" }))
  return openAdvancedEditor()
}

it("opens with the built-in list, loads fifty more rules and resets pagination after a search", async () => {
  await renderRules()
  expect(screen.getByRole("tab", { name: "siteRules.builtIn" })).toHaveAttribute("aria-selected", "true")
  expect(screen.queryByRole("textbox", { name: "siteRules.editorLabel" })).not.toBeInTheDocument()
  expect(screen.getAllByRole("switch")).toHaveLength(50)
  expect(screen.getByRole("button", { name: "siteRules.viewRule: readomi-preserve-text-defaults" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "siteRules.sourceProject" })).toHaveAttribute("href", "https://github.com/mengxi-ream/read-frog")
  expect(screen.getByRole("link", { name: "GPL-3.0" })).toHaveAttribute("href", "https://github.com/mengxi-ream/read-frog/blob/main/LICENSE")
  fireEvent.click(screen.getByRole("button", { name: "siteRules.showMore" }))
  expect(screen.getAllByRole("switch")).toHaveLength(100)
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "twitter.com" } })
  expect(screen.getAllByRole("switch")).toHaveLength(1)
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } })
  expect(screen.getAllByRole("switch")).toHaveLength(50)
})

it("opens the custom rules tab when following the saved notice link", async () => {
  const previousUrl = window.location.href
  window.history.replaceState(null, "", "?siteRulesTab=custom#reading/site-rules")
  try {
    await renderRules()
    expect(screen.getByRole("tab", { name: "siteRules.custom" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tabpanel", { name: "siteRules.custom" })).toBeVisible()
  }
  finally {
    window.history.replaceState(null, "", previousUrl)
  }
})

it("keeps an old Read Frog disabled rule off and clears its old identifier when re-enabled", async () => {
  const store = await renderRules({ userRules: [], disabledBuiltInRules: ["readfrog-preserve-text-defaults"] })
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "readomi-preserve-text-defaults" } })
  const toggle = screen.getByRole("switch")
  expect(toggle).toHaveAttribute("aria-checked", "false")
  fireEvent.click(toggle)
  await waitFor(() => expect(store.get(configAtom).siteRules.disabledBuiltInRules).toEqual([]))
  await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.siteRules.disabledBuiltInRules).toEqual([]))
  expect(toggle).toHaveAttribute("aria-checked", "true")
})

it("searches by domain, expands and copies a complete rule, and persists a built-in toggle", async () => {
  const store = await renderRules()
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "twitter.com" } })
  expect(screen.getAllByRole("switch")).toHaveLength(1)
  fireEvent.click(screen.getByRole("button", { name: "siteRules.viewRule: twitter" }))
  expect(screen.getByText(/forceInlineStyleSelectors/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "siteRules.copy" }))
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining("\"id\": \"twitter\"")))
  expect(await screen.findByRole("button", { name: "siteRules.copied" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("switch"))
  await waitFor(() => expect(store.get(configAtom).siteRules.disabledBuiltInRules).toEqual(["twitter"]))
  await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.siteRules.disabledBuiltInRules).toEqual(["twitter"]))
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-such-readomi-site" } })
  expect(screen.getByText("siteRules.noMatches")).toBeInTheDocument()
})

it("reports a failed copy without changing the built-in rule", async () => {
  const store = await renderRules()
  vi.mocked(copyText).mockResolvedValueOnce(false)
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "twitter.com" } })
  fireEvent.click(screen.getByRole("button", { name: "siteRules.viewRule: twitter" }))
  fireEvent.click(screen.getByRole("button", { name: "siteRules.copy" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("siteRules.copyFailed")
  expect(store.get(configAtom).siteRules.disabledBuiltInRules).toEqual([])
})

it("copies built-in translation CSS with Readomi classes so it also works as a custom rule", async () => {
  await renderRules()
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wikipedia" } })
  fireEvent.click(screen.getByRole("button", { name: "siteRules.viewRule: wikipedia" }))
  fireEvent.click(screen.getByRole("button", { name: "siteRules.copy" }))
  await waitFor(() => expect(copyText).toHaveBeenCalledOnce())
  const copied = vi.mocked(copyText).mock.calls[0]![0]
  expect(copied).toContain("readomi-")
  expect(copied).not.toContain("read-frog-")
})

it("supports keyboard tab navigation and preserves an active draft when switching tabs", async () => {
  await renderRules()
  const builtinTab = screen.getByRole("tab", { name: "siteRules.builtIn" })
  builtinTab.focus()
  fireEvent.keyDown(builtinTab, { key: "ArrowRight" })
  expect(screen.getByRole("tab", { name: "siteRules.custom" })).toHaveFocus()
  expect(screen.getByText("siteRules.emptyTitle")).toBeInTheDocument()
  const editor = openAdvancedEditor()
  const draft = "[{\"id\":\"draft\",\"matches\":\"example.com\"}]"
  fireEvent.change(editor, { target: { value: draft } })
  fireEvent.click(builtinTab)
  expect(screen.queryByRole("textbox", { name: "siteRules.editorLabel" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("tab", { name: "siteRules.custom" }))
  expect(screen.getByRole("textbox", { name: "siteRules.editorLabel" })).toHaveValue(draft)
})

it("validates a custom draft before save and returns to the overview after persisting valid rules", async () => {
  const store = await renderRules()
  const editor = openEditor()
  const invalid = "[{\"id\":\"example\",\"matches\":\"example.com\",\"unknown\":true}]"
  fireEvent.change(editor, { target: { value: invalid } })
  expect(screen.getByRole("button", { name: "siteRules.save" })).toBeDisabled()
  expect(await screen.findByRole("alert")).toHaveTextContent("siteRules.errors.schema")
  expect(screen.getByRole("button", { name: "siteRules.save" })).toBeDisabled()
  expect(editor).toHaveValue(invalid)
  expect(store.get(configAtom).siteRules.userRules).toEqual([])
  const rules = [{ id: "example", matches: "example.com", minWords: 1 }]
  fireEvent.change(editor, { target: { value: JSON.stringify(rules) } })
  await waitFor(() => expect(screen.getByRole("button", { name: "siteRules.save" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "siteRules.save" }))
  await waitFor(async () => expect((await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`))?.siteRules.userRules).toEqual(rules))
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "siteRules.editorLabel" })).not.toBeInTheDocument())
  expect(screen.getByText("example")).toBeInTheDocument()
  openAdvancedEditor()
  expect(screen.getByRole("textbox", { name: "siteRules.editorLabel" })).toHaveValue(JSON.stringify(rules, null, 2))
})

it("cancels unsaved changes and opens existing rules in the compact overview", async () => {
  const rules = [{ id: "existing", matches: "example.com" }]
  const store = await renderRules({ userRules: rules, disabledBuiltInRules: [] })
  fireEvent.click(screen.getByRole("tab", { name: "siteRules.custom" }))
  expect(screen.getByText("existing")).toBeInTheDocument()
  expect(screen.queryByRole("textbox", { name: "siteRules.editorLabel" })).not.toBeInTheDocument()
  openAdvancedEditor()
  fireEvent.change(screen.getByRole("textbox", { name: "siteRules.editorLabel" }), { target: { value: "[]" } })
  fireEvent.click(screen.getByRole("button", { name: "siteRules.cancel" }))
  expect(screen.queryByRole("textbox", { name: "siteRules.editorLabel" })).not.toBeInTheDocument()
  expect(store.get(configAtom).siteRules.userRules).toEqual(rules)
  openAdvancedEditor()
  expect(screen.getByRole("textbox", { name: "siteRules.editorLabel" })).toHaveValue(JSON.stringify(rules, null, 2))
})

it("retains a draft and rolls back the toggle when storage rejects a write", async () => {
  const store = await renderRules()
  const editor = openEditor()
  const draft = "[{\"id\":\"draft\",\"matches\":\"example.com\"}]"
  fireEvent.change(editor, { target: { value: draft } })
  fireEvent.click(screen.getByRole("tab", { name: "siteRules.builtIn" }))
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "twitter.com" } })
  vi.spyOn(storageAdapter, "set").mockRejectedValueOnce(new Error("Write failed"))
  fireEvent.click(screen.getByRole("switch"))
  expect(await screen.findByRole("alert")).toHaveTextContent("siteRules.errors.saveFailed")
  expect(store.get(configAtom).siteRules.disabledBuiltInRules).toEqual([])
  fireEvent.click(screen.getByRole("tab", { name: "siteRules.custom" }))
  expect(screen.getByRole("textbox", { name: "siteRules.editorLabel" })).toHaveValue(draft)
})

it("keeps a valid draft open when saving fails", async () => {
  const store = await renderRules()
  const editor = openEditor()
  const draft = "[{\"id\":\"draft\",\"matches\":\"example.com\"}]"
  fireEvent.change(editor, { target: { value: draft } })
  await waitFor(() => expect(screen.getByRole("button", { name: "siteRules.save" })).toBeEnabled())
  vi.spyOn(storageAdapter, "set").mockRejectedValueOnce(new Error("Write failed"))
  fireEvent.click(screen.getByRole("button", { name: "siteRules.save" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("siteRules.errors.saveFailed")
  expect(screen.getByRole("textbox", { name: "siteRules.editorLabel" })).toHaveValue(draft)
  expect(store.get(configAtom).siteRules.userRules).toEqual([])
  expect(within(screen.getByRole("tabpanel", { name: "siteRules.custom" })).getByRole("button", { name: "siteRules.save" })).toBeEnabled()
})

it("follows external rules after reverting the input but preserves an unfinished draft", async () => {
  const rules = [{ id: "existing", matches: "example.com" }]
  const store = await renderRules({ userRules: rules, disabledBuiltInRules: [] })
  fireEvent.click(screen.getByRole("tab", { name: "siteRules.custom" }))
  openAdvancedEditor()
  const editor = screen.getByRole("textbox", { name: "siteRules.editorLabel" })
  fireEvent.change(editor, { target: { value: "[]" } })
  fireEvent.change(editor, { target: { value: JSON.stringify(rules, null, 2) } })
  const external = [{ id: "external", matches: "external.example.com" }]
  act(() => store.set(configAtom, { ...store.get(configAtom), siteRules: { ...store.get(configAtom).siteRules, userRules: external } }))
  expect(editor).toHaveValue(JSON.stringify(external, null, 2))
  const draft = "[{\"id\":\"unfinished\",\"matches\":\"draft.example.com\"}]"
  fireEvent.change(editor, { target: { value: draft } })
  act(() => store.set(configAtom, { ...store.get(configAtom), siteRules: { ...store.get(configAtom).siteRules, userRules: rules } }))
  expect(editor).toHaveValue(draft)
  fireEvent.click(screen.getByRole("button", { name: "siteRules.cancel" }))
  openAdvancedEditor()
  expect(screen.getByRole("textbox", { name: "siteRules.editorLabel" })).toHaveValue(JSON.stringify(rules, null, 2))
})
