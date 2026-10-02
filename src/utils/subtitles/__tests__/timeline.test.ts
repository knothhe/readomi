// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { cueAt, parseYouTubeTranscript } from "../timeline"

describe("youTube subtitle timeline", () => {
  it("combines word segments, ignores window commands and ends overlapping ASR windows at the next cue", () => {
    const cues = parseYouTubeTranscript(JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: "Reading " }, { utf8: "matters.", tOffsetMs: 500 }] },
      { tStartMs: 1000, wWinId: 1 },
      { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: "<b>Hello</b> &amp; goodbye." }] },
      { tStartMs: -1, dDurationMs: 100, segs: [{ utf8: "invalid" }] },
    ] }))
    expect(cues).toEqual([{ start: 0, end: 2, text: "Reading matters." }, { start: 2, end: 4, text: "Hello & goodbye." }])
    expect(cueAt(cues, 1)?.text).toBe("Reading matters.")
    expect(cueAt(cues, 2)?.text).toBe("Hello & goodbye.")
    expect(cueAt(cues, 4)).toBeUndefined()
  })
  it("reads legacy and srv3 XML, preserves gaps and rejects malformed responses", () => {
    const cues = parseYouTubeTranscript("<transcript><text start=\"1\" dur=\"2\">Hello &amp; world</text><text start=\"5\" dur=\"1\">Next</text></transcript>")
    expect(cues).toEqual([{ start: 1, end: 3, text: "Hello & world" }, { start: 5, end: 6, text: "Next" }])
    expect(cueAt(cues, 4)).toBeUndefined()
    expect(parseYouTubeTranscript("<timedtext><body><p t=\"1000\" d=\"2000\"><s>Hello</s><s> world</s></p></body></timedtext>")[0]).toEqual(cues[0] && { start: 1, end: 3, text: "Hello world" })
    expect(parseYouTubeTranscript("not a subtitle")).toEqual([])
    expect(parseYouTubeTranscript("{\"events\":[{\"tStartMs\":0,\"segs\":null}]}")).toEqual([])
  })
})
