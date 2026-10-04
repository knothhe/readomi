declare module "virtual:readomi-ui-messages" {
  export type CompactUIMessage = string | [string, Record<string, { content: string }>]
  export const messageIndexes: Record<string, number>
  export const catalogs: Record<string, Array<CompactUIMessage | null>>
}
