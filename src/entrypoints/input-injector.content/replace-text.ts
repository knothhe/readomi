import { isDraftElement, replaceDraft } from "./editors/draft-js"
import { isLexicalElement, replaceLexical } from "./editors/lexical"
import { isSlateElement, replaceSlate } from "./editors/slate"

export function replaceText(element: HTMLElement, text: string): boolean {
  if (isLexicalElement(element))
    return replaceLexical(element, text)
  if (isSlateElement(element))
    return replaceSlate(element, text)
  if (isDraftElement(element))
    return replaceDraft(element, text)
  const doc = element.ownerDocument
  const selection = element.getRootNode() instanceof ShadowRoot
    ? (element.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ?? doc.getSelection()
    : doc.getSelection()
  if (!selection || !doc.execCommand)
    return false
  // Select only this editor; document-level selectAll can replace the whole page.
  const range = doc.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  return doc.execCommand("insertText", false, text)
}
