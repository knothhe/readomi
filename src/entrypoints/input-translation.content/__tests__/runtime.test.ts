// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContentScriptContext } from "wxt/utils/content-script-context"
import { bootstrapInputTranslation } from "../runtime"

const { bind, removeToast, unwatch, dispose } = vi.hoisted(() => ({
  bind: vi.fn(),
  removeToast: vi.fn(),
  unwatch: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock("../../host.content/translation-control/input-translation", () => ({ bindInputTranslation: bind }))
vi.mock("../../host.content/mount-host-toast", () => ({ mountHostToast: () => removeToast }))
vi.mock("@/utils/site-rules/preview-config", () => ({ subscribeHostConfig: () => unwatch }))

let ctx: ContentScriptContext
describe("standalone input translation runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    delete window.__READOMI_INPUT_TRANSLATION__
    bind.mockResolvedValue(dispose)
    ctx = new ContentScriptContext("input-translation", { noScriptStartedPostMessage: true })
  })
  afterEach(() => {
    ctx.notifyInvalidated()
    vi.useRealTimers()
  })

  it("deduplicates manifest and programmatic injection and releases resources on invalidation", async () => {
    await bootstrapInputTranslation(ctx)
    await bootstrapInputTranslation(ctx)
    expect(bind).toHaveBeenCalledOnce()
    expect(bind).toHaveBeenCalledWith(document, expect.any(Function))
    ctx.notifyInvalidated()
    expect(dispose).toHaveBeenCalledOnce()
    expect(removeToast).toHaveBeenCalledOnce()
    expect(unwatch).toHaveBeenCalledOnce()
    expect(window.__READOMI_INPUT_TRANSLATION__).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("disposes a binding that finishes after its context is invalidated", async () => {
    let resolve!: (value: () => void) => void
    bind.mockReturnValue(new Promise<() => void>((done) => {
      resolve = done
    }))
    const startup = bootstrapInputTranslation(ctx)
    ctx.notifyInvalidated()
    resolve(dispose)
    await startup
    expect(dispose).toHaveBeenCalledOnce()
    expect(window.__READOMI_INPUT_TRANSLATION__).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
