/** Effective domain subtitle preference, delivered with the current page URL. */
export interface PageSubtitleState {
  url: string
  enabled: boolean
  available: boolean
  overridden: boolean
  /** Persisted selection while the website is paused; enabled remains false. */
  selectedEnabled?: boolean
}
