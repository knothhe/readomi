import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

const getItemMock = vi.fn()
const clearMock = vi.fn()
const setItemMock = vi.fn()
const loggerErrorMock = vi.fn()

vi.mock("#imports", () => ({
  storage: {
    getItem: getItemMock,
    clear: clearMock,
    setItem: setItemMock,
  },
}))

vi.mock("wxt/utils/storage", () => ({
  storage: {
    getItem: getItemMock,
    clear: clearMock,
    setItem: setItemMock,
  },
}))

vi.mock("@/utils/logger", () => ({
  logger: {
    error: loggerErrorMock,
  },
}))

function buildStableConfig(): Config {
  const config = structuredClone(DEFAULT_CONFIG)
  config.providersConfig = config.providersConfig.map((providerConfig) => {
    const apiKeyEnvName = `WXT_${providerConfig.provider.toUpperCase()}_API_KEY`
    const envApiKey = import.meta.env[apiKeyEnvName] as string | undefined
    if (!envApiKey) {
      return providerConfig
    }

    return {
      ...providerConfig,
      apiKey: envApiKey,
    }
  })
  return config
}

describe("initializeConfig", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setItemMock.mockResolvedValue(undefined)
    clearMock.mockResolvedValue(undefined)
  })

  it("does not write when a valid config is stored", async () => {
    getItemMock.mockResolvedValueOnce(buildStableConfig())

    const { initializeConfig } = await import("../init")
    await initializeConfig()

    expect(setItemMock).not.toHaveBeenCalled()
    expect(clearMock).not.toHaveBeenCalled()
  })

  it("writes the default config when none is stored", async () => {
    getItemMock.mockResolvedValueOnce(null)

    const { initializeConfig } = await import("../init")
    await initializeConfig()

    expect(setItemMock).toHaveBeenCalledTimes(1)
    expect(setItemMock).toHaveBeenCalledWith("local:config", buildStableConfig())
    expect(clearMock).not.toHaveBeenCalled()
  })

  it("leaves an incomplete stored config and other local storage untouched", async () => {
    const { features: _, ...incomplete } = buildStableConfig()
    getItemMock.mockResolvedValueOnce(incomplete)

    const { initializeConfig } = await import("../init")
    await initializeConfig()

    expect(clearMock).not.toHaveBeenCalled()
    expect(setItemMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining("features"))
  })

  it("logs invalid fields without exposing the API key or changing storage", async () => {
    const config = buildStableConfig()
    getItemMock.mockResolvedValueOnce({
      ...config,
      providersConfig: config.providersConfig.map(provider => ({ ...provider, apiKey: "sk-secret", temperature: -1 })),
    })

    const { initializeConfig } = await import("../init")
    await initializeConfig()

    expect(clearMock).not.toHaveBeenCalled()
    expect(setItemMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).toHaveBeenCalledTimes(1)
    const [message] = loggerErrorMock.mock.calls[0]
    expect(message).toContain("providersConfig.0.temperature")
    expect(message).not.toContain("sk-secret")
  })
})
