const retries = new Set<(signal?: AbortSignal) => Promise<void>>()

/** Register actual extension-owned errors, including those in shadow roots. */
export function registerFailedTranslation(retry: (signal?: AbortSignal) => Promise<void>) {
  retries.add(retry)
  return () => {
    retries.delete(retry)
  }
}

export async function retryFailedTranslations(signal?: AbortSignal) {
  await Promise.all([...retries].map(retry => retry(signal)))
}
