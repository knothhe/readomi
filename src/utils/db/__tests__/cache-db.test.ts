import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function databaseFixture() {
  const transaction = { objectStore: vi.fn(), error: null } as unknown as IDBTransaction
  const clearRequest = {} as IDBRequest<undefined>
  const clear = vi.fn(() => clearRequest)
  const store = { transaction, clear } as unknown as IDBObjectStore
  vi.mocked(transaction.objectStore).mockReturnValue(store)
  const db = { transaction: vi.fn(() => transaction) } as unknown as IDBDatabase
  const openRequest = { result: db } as IDBOpenDBRequest
  vi.stubGlobal("indexedDB", { open: vi.fn(() => openRequest) })
  return { transaction, clearRequest, clear, db, openRequest }
}

describe("cache clear transaction completion", () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it("waits for commit rather than reporting success when the clear request succeeds", async () => {
    const fixture = databaseFixture()
    const { cacheDb } = await import("../cache-db")
    let settled = false
    const pending = cacheDb.translationCache.clear().then(() => settled = true)
    fixture.openRequest.onsuccess?.(new Event("success"))
    await vi.waitFor(() => expect(fixture.clear).toHaveBeenCalledOnce())
    fixture.clearRequest.onsuccess?.(new Event("success"))
    await Promise.resolve()
    expect(settled).toBe(false)
    fixture.transaction.oncomplete?.(new Event("complete"))
    await pending
    expect(settled).toBe(true)
    expect(fixture.db.transaction).toHaveBeenCalledWith("translationCache", "readwrite")
  })

  it("rejects an aborted clear transaction even after the request succeeded", async () => {
    const fixture = databaseFixture()
    const { cacheDb } = await import("../cache-db")
    const pending = expect(cacheDb.translationCache.clear()).rejects.toThrow("Clear aborted")
    fixture.openRequest.onsuccess?.(new Event("success"))
    await vi.waitFor(() => expect(fixture.clear).toHaveBeenCalledOnce())
    fixture.clearRequest.onsuccess?.(new Event("success"))
    Object.defineProperty(fixture.transaction, "error", { value: new DOMException("Clear aborted", "AbortError") })
    fixture.transaction.onabort?.(new Event("abort"))
    await pending
  })
})
