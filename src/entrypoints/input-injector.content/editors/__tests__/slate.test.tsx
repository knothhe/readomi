// @vitest-environment jsdom
import type { ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { useMemo, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { replaceSlate } from "../slate"

function createEditor() {
  return {
    children: [{ children: [{ text: "First paragraph" }] }, { children: [{ text: "Second paragraph  " }] }],
    selection: null,
    apply: vi.fn(),
    insertText: vi.fn(),
  }
}

type Editor = ReturnType<typeof createEditor>

function Editable({ text }: { text?: string }) {
  return <div data-testid="editor" data-slate-editor="true" contentEditable suppressContentEditableWarning>{text}</div>
}

function MemoEditor({ create }: { create: () => Editor }) {
  const editor = useMemo(create, [create])
  return <Editable text={editor.children[0].children[0].text} />
}

function StateEditor({ create }: { create: () => Editor }) {
  const [editor] = useState(create)
  return <Editable text={editor.children[0].children[0].text} />
}

function Provider({ editor: _editor, children }: { editor: Editor, children: ReactNode }) {
  return <>{children}</>
}

describe("slate input replacement", () => {
  afterEach(cleanup)

  it.each(["memo", "state", "props"] as const)("finds an editor held in %s and selects all paragraphs", (storage) => {
    const editor = createEditor()
    // Use real React fibers, including useMemo's [value, dependencies] storage.
    const view = storage === "memo"
      ? <MemoEditor create={() => editor} />
      : storage === "state"
        ? <StateEditor create={() => editor} />
        : <Provider editor={editor}><Editable /></Provider>
    render(view)

    expect(replaceSlate(screen.getByTestId("editor"), "第一段\n第二段")).toBe(true)
    expect(editor.apply).toHaveBeenCalledWith({
      type: "set_selection",
      properties: null,
      newProperties: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [1, 0], offset: "Second paragraph  ".length },
      },
    })
    expect(editor.insertText).toHaveBeenCalledWith("第一段\n第二段")
  })
})
