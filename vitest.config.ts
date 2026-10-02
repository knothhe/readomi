import { configDefaults, defineConfig } from "vitest/config"

import { WxtVitest } from "wxt/testing/vitest-plugin"
import { uiLanguageMessages } from "./scripts/ui-language-messages.ts"

export default defineConfig({
  // TODO: remove any
  plugins: [WxtVitest() as any, uiLanguageMessages()],
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/repos/**"],
    environment: "node",
    globals: true,
    setupFiles: "vitest.setup.ts",
    watch: false,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      // include: ['src/**/*.{ts,tsx}'],
      // exclude: ['src/**/*.spec.ts']
    },
  },
})
