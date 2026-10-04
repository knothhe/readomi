import type { SiteRule } from "@/types/config/site-rules"

// Observed on the Threads home feed and post detail in the site-adaptation
// session. The first paragraph's optional xdj266r class is not a post boundary.
const postBody = ".x1a6qonq:has(> div.xat24cr.x1n2onr6 > span.x1lliihq.x1plvlek)"
const oldParagraph = ".x1a6qonq > div.xat24cr.x1n2onr6.xdj266r > span.x1lliihq.x1plvlek"

/** Keep one request per post while the extractor retains its visual paragraphs. */
export const READOMI_THREADS_RULE: SiteRule = {
  "id": "readomi-threads-post-body",
  "description": "Translate each Threads post once, preserving paragraphs and the selected translation style",
  "matches": ["www.threads.com", "www.threads.net"],
  "excludeSelectors.remove": [".x6s0dn4.x78zum5"],
  "excludeSelectors.add": [
    ".x6s0dn4.x78zum5:not(:has(.x1a6qonq > div.xat24cr.x1n2onr6 > span.x1lliihq.x1plvlek))",
    `${postBody} .x1rg5ohu`,
  ],
  "includeSelectors.add": [postBody],
  "includeSelectors.remove": [oldParagraph],
  "forceBlockNodeSelectors.add": [postBody],
  "forceBlockNodeSelectors.remove": [oldParagraph],
  "forceBlockStyleSelectors.add": [postBody],
  "forceBlockStyleSelectors.remove": [oldParagraph],
  // Group these source divs into their containing post. This does not change
  // their natural display:block or remove their source paragraph boundaries.
  "forceInlineNodeSelectors.add": [
    `${postBody} > div.xat24cr.x1n2onr6`,
    `${postBody} > div.xat24cr.x1n2onr6 > span.x1lliihq.x1plvlek`,
  ],
  "preserveTextSelectors.remove": [".x1rg5ohu"],
  "preserveTextSelectors.add": [`.x1rg5ohu:not(${postBody} .x1rg5ohu)`],
  "injectedCss.add": [
    // The source post already ends in a block paragraph. The generic leading
    // BR otherwise adds a full blank line only when the stream is committed.
    `${postBody} > .readomi-translated-content-wrapper[data-readomi-translation-mode="bilingual"]:has(> .readomi-translated-block-content) > br:first-child { display: none !important; }`,
  ],
}
