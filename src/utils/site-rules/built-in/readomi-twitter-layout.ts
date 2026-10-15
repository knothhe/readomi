import type { SiteRule } from "@/types/config/site-rules"
import { CONTENT_WRAPPER_CLASS } from "@/utils/constants/dom-labels"

/** Keep upstream layout fixes local to containers that actually hold a translation. */
export function scopeTwitterLayout(rule: SiteRule): SiteRule {
  if (rule.id !== "twitter")
    return rule

  // A paragraph hover installs the stylesheet for the entire document. Without
  // this guard, every collapsed quote above it expands before the request ends,
  // moving the reader away from the paragraph they just translated.
  const translated = `:has(.${CONTENT_WRAPPER_CLASS})`
  return {
    ...rule,
    "injectedCss.add": [
      `[data-testid='card.layoutLarge.detail'] > div:nth-child(2)${translated} {-webkit-line-clamp: unset!important;}`,
      `[data-testid='card.layoutSmall.detail'] > div:nth-child(2)${translated} {-webkit-line-clamp: unset!important;}`,
      `[data-testid='tweetText']${translated},[style*='-webkit-line-clamp']${translated} {-webkit-line-clamp: unset!important;}`,
      `[role=dialog] [style*='webkit-line-clamp']${translated} {-webkit-line-clamp: unset!important;}`,
      `.r-h9hxbl${translated}{width:unset;}`,
      `[aria-label=Grok] [data-testid=ScrollSnap-SwipeableList] [role=presentation] > div > div${translated} { max-height: unset !important; }`,
    ],
  }
}
