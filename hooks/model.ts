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

export type EndStatus = Exclude<RabeItemStatus, 'running' | 'idle'>

// Every kind, in the order the band and the diagnostics list them.
export const KINDS = ['agent', 'codex', 'workflow', 'shell', 'monitor', 'cron'] as const

// The item that started `item`, if it is in the list.
export function parentOf(item: Pick<RabeItem, 'parentId'>, items: readonly RabeItem[]) {
  return item.parentId === undefined ? undefined : items.find(one => one.id === item.parentId)
}

// The workflow run that started `item`, if it is in the list.
export function runOf(item: Pick<RabeItem, 'parentId'>, items: readonly RabeItem[]) {
  const parent = parentOf(item, items)

  return parent?.kind === 'workflow' ? parent : undefined
}

export function isEnded(item: Pick<RabeItem, 'status'>): boolean {
  return item.status !== 'running' && item.status !== 'idle'
}

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

// A Windows path: a drive (`C:\`, `c:/`) or UNC (`\\host\share`, `//host/share`).
const isWindows = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]/.test(path)

export const isAbsolute = (path: string) => path.startsWith('/') || isWindows(path)

// What two paths are compared by: a Windows path with `/` and in lower case,
// since Windows ignores case; a POSIX path as it is.
export const pathKey = (path: string) =>
  isWindows(path) ? path.replace(/\\/g, '/').toLowerCase() : path

// Whether `path` is `root` or inside it.
export function isInside(path: string, root: string): boolean {
  const at = pathKey(path)
  const base = pathKey(root).replace(/\/+$/, '')

  return at === base || at.startsWith(`${base}/`)
}
