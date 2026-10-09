import type { RabeItem, RabeItemDetails, RabeItemKind, RabeItemOf, RabeItemStatus } from '../types'

export type {
  RabeItem,
  RabeItemDetails,
  RabeItemKind,
  RabeItemOf,
  RabeItemStatus,
  RabeTokens,
  RabeToolUse,
  RabeTurn,
} from '../types'

export type NewItem = { [K in RabeItemKind]: Omit<RabeItemOf<K>, 'seenAt'> }[RabeItemKind]

export type ItemPatch = Partial<
  Pick<RabeItem, 'title' | 'status' | 'startedAt' | 'endedAt' | 'parentId' | 'tokens' | 'costUsd'>
> & { detail?: Partial<RabeItemDetails[RabeItemKind]> }

export type EndStatus = Exclude<RabeItemStatus, 'running'>

// Cuts text to `max` characters, the last one an ellipsis.
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function itemId(kind: RabeItemKind, nativeId: string): string {
  return `${kind}:${nativeId}`
}

export function mergeItem(item: RabeItem, patch: ItemPatch): RabeItem {
  return {
    ...item,
    ...patch,
    seenAt: item.seenAt,
    detail: { ...item.detail, ...patch.detail },
  } as RabeItem
}
