export interface BrowserEnvironment { name: string, supported: boolean }
interface BrowserNavigator {
  userAgent?: string
  userAgentData?: { brands: { brand: string }[] }
  brave?: { isBrave: () => Promise<boolean> }
}

/** Check the running browser too: Chrome builds can be installed in Edge or Brave. */
export async function detectBrowserEnvironment(nav: BrowserNavigator = navigator, build = import.meta.env.BROWSER): Promise<BrowserEnvironment> {
  const ua = nav.userAgent ?? ""
  const brands = nav.userAgentData?.brands.map(item => item.brand) ?? []
  if (build === "firefox" || /Firefox\//.test(ua))
    return { name: "Firefox", supported: false }
  if (build === "edge" || /Edg(?:e|A|iOS)?\//.test(ua) || brands.includes("Microsoft Edge"))
    return { name: "Microsoft Edge", supported: false }
  if (/OPR\//.test(ua) || brands.some(brand => /Opera/.test(brand)))
    return { name: "Opera", supported: false }
  if (nav.brave) {
    try {
      if (await nav.brave.isBrave())
        return { name: "Brave", supported: false }
    }
    catch { return { name: "", supported: false } }
  }
  const chrome = brands.length ? brands.includes("Google Chrome") : /Chrome\//.test(ua) && !/Chromium\//.test(ua)
  return { name: chrome ? "Google Chrome" : "", supported: chrome && build === "chrome" }
}
