/** Effective subtitle switch for one page, shared by its popup and players. */
export interface PageSubtitleState {
  url: string
  enabled: boolean
  available: boolean
  overridden: boolean
  /** Persisted selection while the website is paused; enabled remains false. */
  selectedEnabled?: boolean
}
