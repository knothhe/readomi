// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { createTextTrackSession } from "../text-track-session"

interface FakeTrack {
  kind: string
  label: string
  language: string
  mode: TextTrackMode
}

function fixture(...tracks: FakeTrack[]) {
  const events = new EventTarget()
  const list = Object.assign(tracks, {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  })
  const video = { textTracks: list } as unknown as HTMLVideoElement
  return { video, list, emit: (type: string) => events.dispatchEvent(new Event(type)) }
}

const subtitle = (label: string, mode: TextTrackMode): FakeTrack => ({ kind: "subtitles", label, language: "en", mode })

describe("native subtitle session", () => {
  it("reads the X source instead of its clone, hides both renderers and restores their different native modes", () => {
    const clone = subtitle("clone", "showing")
    const source = subtitle("en (auto-generated)", "disabled")
    const { video } = fixture(clone, source)
    const session = createTextTrackSession(video, track => track.label !== "clone")
    expect(session.sync()).toBe(source)
    expect(source.mode).toBe("hidden")
    expect(clone.mode).toBe("hidden")
    session.dispose()
    expect(source.mode).toBe("disabled")
    expect(clone.mode).toBe("showing")
  })

  it("hides newly added rendering tracks and restores the last player request after a language switch", () => {
    const english = subtitle("English", "showing")
    const { video, list, emit } = fixture(english)
    const session = createTextTrackSession(video, track => track.label !== "clone")
    session.sync()
    const clone = subtitle("clone", "showing")
    list.push(clone)
    emit("addtrack")
    expect(clone.mode).toBe("hidden")
    const japanese = { ...subtitle("日本語", "showing"), language: "ja" }
    list.push(japanese)
    english.mode = "disabled"
    clone.mode = "disabled"
    emit("change")
    expect(session.sync()).toBe(japanese)
    expect(japanese.mode).toBe("hidden")
    session.dispose()
    expect(english.mode).toBe("disabled")
    expect(clone.mode).toBe("disabled")
    expect(japanese.mode).toBe("showing")
    english.mode = "showing"
    emit("change")
    expect(english.mode).toBe("showing")
  })

  it("leaves native captions visible when X only provides the clone and releases them if the source disappears", () => {
    const clone = subtitle("clone", "showing")
    const { video, list, emit } = fixture(clone)
    const session = createTextTrackSession(video, track => track.label !== "clone")
    expect(session.sync()).toBeUndefined()
    expect(clone.mode).toBe("showing")
    const source = subtitle("English", "hidden")
    list.push(source)
    emit("addtrack")
    expect(session.sync()).toBe(source)
    expect(clone.mode).toBe("hidden")
    list.pop()
    emit("change")
    expect(session.sync()).toBeUndefined()
    expect(clone.mode).toBe("showing")
    session.dispose()
  })
})
