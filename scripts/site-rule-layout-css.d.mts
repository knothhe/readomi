interface CSSFields {
  "injectedCss"?: string
  "injectedCss.add"?: string[]
}
export function scopeBuiltInCSS(css: string): string
export function buildLayoutCSS(rules: readonly (CSSFields & { id: string })[]): Record<string, CSSFields>
