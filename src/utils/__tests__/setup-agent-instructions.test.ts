import type { Config } from "@/types/config/config"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { buildAgentInstructions } from "../setup-agent-instructions"

const config: Config = {
  ...DEFAULT_CONFIG,
  providersConfig: [
    { ...DEFAULT_CONFIG.providersConfig[0], apiKey: "sk-primary-secret" },
    { id: "gemini-account", name: "Gemini account", provider: "gemini", enabled: true, model: "gemini-test", apiKey: "gemini-secondary-secret" },
  ],
}

describe("agent setup instructions", () => {
  beforeEach(() => {
    vi.spyOn(i18n, "t").mockImplementation((key, substitutions) => [key, ...(Array.isArray(substitutions) ? substitutions : [])].join("\n"))
  })
  afterEach(() => vi.restoreAllMocks())

  it("exports the edited inactive account with its key masked", () => {
    const text = buildAgentInstructions(config, "gemini-account")
    expect(text).toContain("\"name\": \"Gemini account\"")
    expect(text).toContain("\"model\": \"gemini-test\"")
    expect(text).not.toContain("\"type\": \"openai\"")
    expect(text).not.toContain("gemini-secondary-secret")
    expect(text).not.toContain("sk-primary-secret")
  })

  it("starts a new service without copying another account's masked configuration", () => {
    const text = buildAgentInstructions(config, null)
    expect(text).toContain(i18n.t("agentInstructions.noConfiguration"))
    expect(text).not.toContain("\"apiKey\"")
    expect(text).not.toContain("\"model\"")
  })

  it("preserves current-service instructions for callers that omit the target", () => {
    expect(buildAgentInstructions(config)).toContain("\"type\": \"openai\"")
  })
})
