import type { ConnectionCheck, ProviderConfig } from "@/types/config/provider"
import type { MoveProviderAction, SaveProviderAction } from "@/utils/service-management"
import { atom } from "jotai"
import { moveProvider, removeProvider, saveProvider, saveProviderCheck, selectProvider } from "@/utils/service-management"
import { mutateConfigAtom } from "./config"

export const saveProviderAtom = atom(null, (_get, set, action: SaveProviderAction) =>
  set(mutateConfigAtom, config => saveProvider(config, action)),
)

export const selectProviderAtom = atom(null, (_get, set, providerId: string) =>
  set(mutateConfigAtom, config => selectProvider(config, providerId)),
)

export const removeProviderAtom = atom(null, (_get, set, providerId: string) =>
  set(mutateConfigAtom, config => removeProvider(config, providerId)),
)

export const moveProviderAtom = atom(null, (_get, set, action: MoveProviderAction) =>
  set(mutateConfigAtom, config => moveProvider(config, action)),
)

export const saveProviderCheckAtom = atom(null, (_get, set, { provider, check }: { provider: ProviderConfig, check: ConnectionCheck }) =>
  set(mutateConfigAtom, config => saveProviderCheck(config, provider, check)),
)
