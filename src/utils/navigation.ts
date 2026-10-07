import { browser } from "#imports"

export interface OpenOptionsPageOptions {
  /** Section id on the settings page to scroll to, e.g. "providers". */
  section?: string
  siteRulesTab?: "builtin" | "custom"
}

export async function openOptionsPage(options?: OpenOptionsPageOptions) {
  const hash = options?.section ? `#${options.section}` : ""
  const query = options?.siteRulesTab ? `?siteRulesTab=${options.siteRulesTab}` : ""

  await browser.tabs.create({
    active: true,
    url: browser.runtime.getURL(`/options.html${query}${hash}`),
  })
}
