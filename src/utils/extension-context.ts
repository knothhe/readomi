import { browser } from "#imports"

export function isExtensionContextValid(): boolean {
  return Boolean(browser.runtime?.id)
}

export function isMessageConnectionLostError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("message channel closed before a response was received")
    || error.message.includes("The message port closed before a response was received")
    || error.message.includes("Could not establish connection. Receiving end does not exist.")
    || error.message.startsWith("No handler answered ")
  )
}

/** Chrome can reject an in-flight request before reporting the invalid runtime. */
export function isExtensionContextInvalidatedError(error: unknown): boolean {
  if (!(error instanceof Error))
    return false
  if (error.message === "Extension context invalidated.")
    return true
  return !isExtensionContextValid() && (
    isMessageConnectionLostError(error)
    || error.message.includes("'wxt/storage' must be loaded in a web extension environment")
  )
}

/** An unloaded extension has already detached its browser event listeners. */
export function removeExtensionListener(remove: () => void): void {
  try {
    remove()
  }
  catch (error) {
    if (isExtensionContextValid() && !isExtensionContextInvalidatedError(error))
      throw error
  }
}
