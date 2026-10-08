import { expect, it } from "vitest"
import { detectBrowserEnvironment } from "@/utils/browser-environment"

it("recognizes Google Chrome and rejects Chromium-only brands", async () => {
  expect(await detectBrowserEnvironment({ userAgentData: { brands: [{ brand: "Google Chrome" }] } }, "chrome")).toEqual({ name: "Google Chrome", supported: true })
  expect((await detectBrowserEnvironment({ userAgentData: { brands: [{ brand: "Chromium" }] }, userAgent: "Chrome/130" }, "chrome")).supported).toBe(false)
})
it.each(["edge", "firefox"])("keeps %s builds disabled even with a Chrome user agent", async (build) => {
  expect((await detectBrowserEnvironment({ userAgent: "Chrome/130" }, build)).supported).toBe(false)
})
it.each(["Chrome/130 Edg/130", "Firefox/140", "Chrome/130 OPR/100", "Chromium/130", "unknown"])("disables the Chrome build in another browser: %s", async (userAgent) => {
  expect((await detectBrowserEnvironment({ userAgent }, "chrome")).supported).toBe(false)
})
it("recognizes Brave even though its user agent looks like Chrome", async () => {
  expect(await detectBrowserEnvironment({ userAgent: "Chrome/130", brave: { isBrave: async () => true } }, "chrome")).toEqual({ name: "Brave", supported: false })
})
