// @vitest-environment jsdom
import type { EditorState as DraftEditorState } from "draft-js"
import { cleanup, render, screen } from "@testing-library/react"
import { EditorState, Modifier } from "draft-js"
import { afterEach, describe, expect, it } from "vitest"
import { replaceDraft } from "../draft-js"

function Editable() {
  return <div className="public-DraftEditor-content" data-testid="editor" contentEditable />
}

function Editor({ editorState: _editorState, onChange: _onChange }: { editorState: DraftEditorState, onChange: (state: DraftEditorState) => void }) {
  return <div className="DraftEditor-root"><Editable /></div>
}

describe("draft.js input replacement", () => {
  afterEach(cleanup)

  it("undoes only the translation after consecutive typing and supports redo", () => {
    const original = "Please confirm the meeting.  "
    const translated = "请确认会议。"
    let state = EditorState.createEmpty()
    for (const character of original) {
      const content = Modifier.insertText(state.getCurrentContent(), state.getSelection(), character)
      state = EditorState.push(state, content, "insert-characters")
    }
    const onChange = (next: DraftEditorState) => {
      state = next
    }
    render(<Editor editorState={state} onChange={onChange} />)

    expect(replaceDraft(screen.getByTestId("editor"), translated)).toBe(true)
    expect(state.getCurrentContent().getPlainText()).toBe(translated)
    const undone = EditorState.undo(state)
    expect(undone.getCurrentContent().getPlainText()).toBe(original)
    expect(EditorState.redo(undone).getCurrentContent().getPlainText()).toBe(translated)
    expect(EditorState.undo(undone).getCurrentContent().getPlainText()).toBe("")
  })
})
