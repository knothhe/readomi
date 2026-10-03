import { z } from "zod"

export const VIDEO_SITE_RULE_TYPES = ["domain", "pattern", "regex"] as const

// Keep stored rules structurally valid without rejecting an entire older
// configuration because one rule is invalid. The editor validates before save;
// the matcher ignores any unsupported rule restored from a backup.
export const videoSiteRuleSchema = z.object({
  type: z.enum(VIDEO_SITE_RULE_TYPES),
  value: z.string(),
})

export type VideoSiteRule = z.infer<typeof videoSiteRuleSchema>
