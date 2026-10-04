import type { SiteRule } from "@/types/config/site-rules"
import { toReadomiSiteRule } from "../branding"
import { READOMI_REDDIT_RULE } from "./readomi-reddit"
import { READOMI_THREADS_RULE } from "./readomi-threads"
import rules from "./rules.json"

/**
 * Readomi's public rule library, adapted from the complete upstream snapshot.
 * IDs, descriptions and DOM names agree across execution, details and copying.
 * The source JSON stays unchanged for provenance and future updates.
 * Array order matters: scalar values from later matching rules take precedence.
 */
export const BUILT_IN_SITE_RULES: SiteRule[] = rules.map(toReadomiSiteRule)

const twitter = BUILT_IN_SITE_RULES.find(rule => rule.id === "twitter")!

/** Readomi behavior retained on top of upstream data; hidden from rule toggles. */
export const READOMI_SITE_RULES: SiteRule[] = [
  {
    id: "readomi-twitter-quote",
    description: "Keep each tweet translation as a separate paragraph using the selected style",
    matches: twitter.matches,
    excludeMatches: twitter.excludeMatches,
    forceBlockNodeSelectors: ["[data-testid=\"tweetText\"]"],
    forceBlockStyleSelectors: ["[data-testid=\"tweetText\"]"],
  },
  {
    id: "readomi-engoo",
    description: "Keep Engoo exercise translations in separate paragraphs",
    matches: "engoo.com",
    forceBlockNodeSelectors: ["#windowexercise-2 > div > div > div.css-ep7xq6 > div > div > div.css-19m2fbm *"],
    forceBlockStyleSelectors: ["#windowexercise-2 > div > div > div.css-ep7xq6 > div > div > div.css-19m2fbm *"],
  },
  READOMI_THREADS_RULE,
  READOMI_REDDIT_RULE,
]

/** Disabling the associated upstream rule also disables its compatibility fix. */
export const READOMI_RULE_DEPENDENCIES: Record<string, string> = {
  "readomi-twitter-quote": "twitter",
  "readomi-engoo": "autoHeight",
  "readomi-threads-post-body": "threads",
  "readomi-reddit-reading": "reddit",
}
