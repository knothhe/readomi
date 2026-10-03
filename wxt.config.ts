import { defineConfig } from "wxt"
import { uiLanguageMessages } from "./scripts/ui-language-messages.ts"

// Readomi's own public key pins its extension ID across local builds.
// Independent of Jiandao's Chrome Web Store identity; no private key is distributed.
const chromeExtensionKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuecehF+RGQfryNv+tY6yUnKklZY9J68UFm5pRK8zeBqGtM26NoAl7u0nSdOAVEF+HA6+2apSteEzXa5+8z5o6mBnr+I28YzBPJYeVxWm1g+ioyIXMIpUWXLJZ7HA3QQ54qmYs9Aly4oxkEWQ6CQ7dVI16W22z70AKp3toGejFHg3dUcNkd92E2eTCbS3MQBiBsuXs0VZlKJ/hHA8i1FTgR2JDujdmMi6VjdI0QbSuwM3T0AsylwS+aygiW3Jix+pRtw4zhuJXlmcJa3K1yy5x0uHSqBqCk0cOtg7ClyBr3gySJuAAkJ0DUBvM9/YKWrA1m7TcrCBT6rZUoxfINwQYQIDAQAB"

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  imports: false,
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    ...(browser === "chrome" && { key: chromeExtensionKey }),
    permissions: [
      "storage",
      "tabs",
      "alarms",
      "scripting",
      "webNavigation",
      ...(browser !== "firefox" ? ["declarativeNetRequestWithHostAccess" as const] : []),
    ],
    host_permissions: [
      "*://*/*", // Required for scripting.executeScript in any frame
    ],
    // Allow images/SVGs referenced by content-script UI <img> tags to be loaded from
    // moz-extension:// URLs on regular pages. Firefox enforces this more strictly.
    web_accessible_resources: [
      {
        resources: ["youtube-bridge.js"],
        matches: ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"],
      },
      {
        resources: ["assets/*.png", "assets/*.svg", "assets/*.webp", "icon/*/*.png"],
        matches: ["*://*/*", "file:///*"],
      },
    ],
    // Firefox-specific settings for MV3
    ...(browser === "firefox" && {
      // Override default CSP to exclude `upgrade-insecure-requests` (Firefox MV3 default),
      // which would upgrade custom provider HTTP URLs (e.g. LAN) to HTTPS.
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
      },
      browser_specific_settings: {
        gecko: {
          id: "readomi@knothhe",
          // Firefox 140 is the first release that shows data_collection_permissions
          // in the install prompt; older releases would need an in-extension consent UI.
          strict_min_version: "140.0",
          // Page text is sent to the model provider the user configures.
          data_collection_permissions: {
            required: ["websiteContent"],
          },
        },
        // Firefox for Android shows data_collection_permissions from 142 on.
        gecko_android: {
          strict_min_version: "142.0",
        },
      },
    }),
  }),
  zip: {
    excludeSources: ["docs/**/*", "assets/**/*", "repos/**/*"],
  },
  dev: {
    server: {
      // Prefer 3333 over WXT's default 3000 while still allowing WXT to pick
      // another open port when 3333 is already taken.
      port: 3333,
      strictPort: false,
    },
  },
  vite: () => ({
    plugins: [uiLanguageMessages()],
  }),
})
