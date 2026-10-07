import type { PageSubtitleState } from "@/types/page-subtitle-state"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useReducer, useRef } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { eventMatchesHotkey, isEditableTarget } from "@/utils/hotkeys"
import { onMessage, sendMessage } from "@/utils/message"
import { subtitlePageKey } from "@/utils/subtitles/page-state"
import { activeTabAtom } from "./atoms"

interface SwitchView {
  state: PageSubtitleState | null
  selection?: { url: string, enabled: boolean }
  pending: boolean
  failed: boolean
}

function updateSwitchView(previous: SwitchView, patch: Partial<SwitchView> | ((previous: SwitchView) => Partial<SwitchView>)): SwitchView {
  const next = { ...previous, ...(typeof patch === "function" ? patch(previous) : patch) }
  if (next.state?.available || next.state?.selectedEnabled !== undefined)
    next.selection = { url: next.state.url, enabled: next.state.selectedEnabled ?? next.state.enabled }
  return next
}

/** Read the live page switch, including changes made while the popup was closed. */
export function usePageSubtitles(disabled = false) {
  const tab = useAtomValue(activeTabAtom)
  const features = useAtomValue(configFieldsAtomMap.features)
  const [{ state, selection, pending, failed }, updateView] = useReducer(updateSwitchView, { state: null, pending: false, failed: false })
  const revisionRef = useRef(0)
  const operationRef = useRef(0)
  const notificationRef = useRef(0)
  const rules = JSON.stringify([features.disabledSites, features.videoExcludedSites])
  useEffect(() => {
    const version = ++revisionRef.current
    let heard = false
    const revision = revisionRef
    const operation = operationRef
    updateView(previous => ({ failed: false, pending: false, state: tab.translatable && previous.state && subtitlePageKey(previous.state.url) === subtitlePageKey(tab.url) ? previous.state : null }))
    if (tab.id === null || !tab.translatable) {
      return
    }
    const unsubscribe = onMessage("pageSubtitleStateChanged", ({ data }) => {
      if (data.tabId !== tab.id || subtitlePageKey(data.state.url) !== subtitlePageKey(tab.url))
        return
      heard = true
      notificationRef.current++
      updateView({ state: data.state })
    })
    void sendMessage("getPageSubtitleState", { tabId: tab.id, url: tab.url }).then((next) => {
      if (revisionRef.current === version && !heard)
        updateView({ state: next ?? null })
    }).catch(() => {
      if (revisionRef.current === version && !heard) {
        updateView({ state: null, failed: true })
      }
    })
    return () => {
      revision.current++
      operation.current++
      unsubscribe()
    }
  }, [disabled, tab.id, tab.url, tab.translatable, features.videoSubtitles, rules])

  const choose = useCallback(async (enabled: boolean) => {
    if (disabled || tab.id === null || !state?.available || pending)
      return
    const request = ++operationRef.current
    revisionRef.current++
    const notice = notificationRef.current
    updateView({ pending: true, failed: false })
    try {
      const next = await sendMessage("setPageSubtitleState", { tabId: tab.id, url: tab.url, enabled })
      if (request === operationRef.current && notice === notificationRef.current)
        updateView({ state: next })
    }
    catch {
      if (request === operationRef.current)
        updateView({ failed: true })
    }
    finally {
      if (request === operationRef.current)
        updateView({ pending: false })
    }
  }, [disabled, tab.id, tab.url, state, pending])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (disabled || !state?.available || pending || event.defaultPrevented || event.repeat || event.isComposing || isEditableTarget(event.target) || !eventMatchesHotkey(event, features.subtitlesShortcut))
        return
      event.preventDefault()
      event.stopPropagation()
      void choose(!state.enabled)
    }
    document.addEventListener("keydown", keydown, true)
    return () => document.removeEventListener("keydown", keydown, true)
  }, [choose, disabled, features.subtitlesShortcut, pending, state])
  const selectedEnabled = selection && tab.translatable && subtitlePageKey(selection.url) === subtitlePageKey(tab.url) ? selection.enabled : features.videoSubtitles
  return { state, selectedEnabled, pending, failed, choose, translatable: tab.translatable }
}
