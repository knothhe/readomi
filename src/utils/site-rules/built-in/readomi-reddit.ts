import type { SiteRule } from "@/types/config/site-rules"
import upstreamRules from "./rules.json"

const reddit = upstreamRules.find(rule => rule.id === "reddit")!
const postContainer = ":is(shreddit-post, shreddit-ad-post)"
// Ads use delegated-link, whose shadow anchor is the full-card hover target.
const cardOverlay = `${postContainer} > :is(a, delegated-link)[slot='full-post-link']`
const feedPost = `${postContainer}:has(> :is(a, delegated-link)[slot='full-post-link'])`
const postTitle = `${postContainer} > [slot='title']`
const bodyParagraph = `${postContainer} [slot='text-body'] .md p`

/** Add Reddit reading boundaries without changing the upstream rule snapshot. */
export const READOMI_REDDIT_RULE: SiteRule = {
  "id": "readomi-reddit-reading",
  "description": "Translate each Reddit feed post as one group and preserve paragraph styles in post details",
  "matches": reddit.matches,
  "excludeMatches": reddit.excludeMatches,
  // The absolute card link is the hover target; its readable siblings belong
  // to the post. Skip its screen-reader copy while walking the post itself.
  "forceInlineNodeSelectors.add": [cardOverlay],
  "excludeSelectors.add": [
    cardOverlay,
    // Other direct children are credit, menus, flair, media and actions. A
    // post group reads only the explicitly named title and text-body sources.
    `${feedPost} > :not([slot='title']):not([slot='text-body'])`,
  ],
  "translationGroups": [{
    containerSelector: feedPost,
    sourceSelectors: [
      ":scope > [slot='title']",
      ":scope > [slot='text-body'] .md",
      ":scope > [slot='text-body']:not(:has(.md))",
    ],
    placement: "append",
    slot: "text-body",
  }],
  "forceBlockNodeSelectors.add": [
    postContainer,
    postTitle,
    "shreddit-post-text-body",
    bodyParagraph,
  ],
  // A container's block style does not apply to the separately extracted p
  // groups. Their source paragraphs need the same explicit layout boundary.
  "forceBlockStyleSelectors.add": [
    feedPost,
    postTitle,
    "shreddit-post-text-body",
    bodyParagraph,
  ],
}
