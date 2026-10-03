export const CONTENT_WRAPPER_CLASS = "readomi-translated-content-wrapper"
export const INLINE_CONTENT_CLASS = "readomi-translated-inline-content"
export const INLINE_ATOM_CLASS = "readomi-inline-atom"
export const BLOCK_CONTENT_CLASS = "readomi-translated-block-content"
export const FLOAT_WRAP_ATTRIBUTE = "data-readomi-float-wrap"

export const WALKED_ATTRIBUTE = "data-readomi-walked"
// paragraph means you need to trigger translation on this element (i.e. we have inline children in it)
export const PARAGRAPH_ATTRIBUTE = "data-readomi-paragraph"
export const BLOCK_ATTRIBUTE = "data-readomi-block-node"
export const INLINE_ATTRIBUTE = "data-readomi-inline-node"

export const TRANSLATION_MODE_ATTRIBUTE = "data-readomi-translation-mode"

export const MARK_ATTRIBUTES = new Set([WALKED_ATTRIBUTE, PARAGRAPH_ATTRIBUTE, BLOCK_ATTRIBUTE, INLINE_ATTRIBUTE])

export const NOTRANSLATE_CLASS = "notranslate"

export const REACT_SHADOW_HOST_CLASS = "readomi-react-shadow-host"

export const TRANSLATION_ERROR_CONTAINER_CLASS = "readomi-translation-error-container"

// The name of the word-prefix emphasis in CSS.highlights. The preset styles paint it with ::highlight(readomi-word-prefix).
export const WORD_PREFIX_HIGHLIGHT = "readomi-word-prefix"
