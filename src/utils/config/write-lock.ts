/** Shared by extension-origin settings pages and the background worker. */
const CONFIG_WRITE_LOCK = "readomi:configuration-write"
let fallbackQueue: Promise<unknown> = Promise.resolve()

export function withConfigWriteLock<T>(write: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request)
    return navigator.locks.request(CONFIG_WRITE_LOCK, { mode: "exclusive" }, write)
  // Older environments still serialize their own writes; supported browsers use Web Locks.
  const task = fallbackQueue.then(write)
  fallbackQueue = task.catch(() => {})
  return task
}
