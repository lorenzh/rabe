import { type EndStatus, type ItemPatch, mergeItem, type NewItem, type RabeItem } from './model'

export const MAX_ENDED = 200

export type Change = (items: RabeItem[]) => RabeItem[]

function sortKeys(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : 1)))
}

function replace(items: RabeItem[], index: number, next: RabeItem): RabeItem[] {
  if (JSON.stringify(items[index], sortKeys) === JSON.stringify(next, sortKeys)) return items

  return items.with(index, next)
}

export function addItem(items: RabeItem[], item: NewItem, now: number): RabeItem[] {
  const index = items.findIndex(one => one.id === item.id)
  if (index === -1) return [...items, { ...item, seenAt: now } as RabeItem]

  return replace(items, index, mergeItem(items[index] as RabeItem, item))
}

export function updateItem(items: RabeItem[], id: string, patch: ItemPatch): RabeItem[] {
  const index = items.findIndex(one => one.id === id)
  if (index === -1) return items

  return replace(items, index, mergeItem(items[index] as RabeItem, patch))
}

export function endItem(items: RabeItem[], id: string, status: EndStatus, now: number): RabeItem[] {
  const item = items.find(one => one.id === id)
  if (item?.status !== 'running') return items

  return updateItem(items, id, { status, endedAt: now })
}

export function capEnded(items: RabeItem[], max = MAX_ENDED): RabeItem[] {
  const ended = items.filter(item => item.status !== 'running')
  if (ended.length <= max) return items
  const dropped = new Set(
    ended
      .toSorted((a, b) => (a.endedAt ?? a.seenAt) - (b.endedAt ?? b.seenAt))
      .slice(0, ended.length - max),
  )

  return items.filter(item => !dropped.has(item))
}

// The changed list, or `undefined` when the capped list is the held one. The
// cleanup hook applies the cap as the list is written, so it sees what the cap drops.
export function commit(held: RabeItem[] | undefined, change: Change): RabeItem[] | undefined {
  const items = held ?? []
  const changed = change(items)
  const next = capEnded(changed)

  const same = next.length === items.length && next.every((item, i) => item === items[i])

  return same ? undefined : changed
}

export const MAX_EVICTED = 1000

// The entries of a per-item record whose key is still an item id; the same
// record when it holds none of another id.
export function keepItems<T>(record: Record<string, T>, items: RabeItem[]): Record<string, T> {
  const ids = new Set(items.map(item => item.id))
  if (Object.keys(record).every(id => ids.has(id))) return record

  return Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)))
}

// The ids of `seen` missing from `kept`, appended to the newest `max` evicted
// ids; the same list when none is missing.
export function evict(
  evicted: string[],
  seen: RabeItem[],
  kept: RabeItem[],
  max = MAX_EVICTED,
): string[] {
  const ids = new Set(kept.map(item => item.id))
  const dropped = [...new Set(seen.map(item => item.id))].filter(id => !ids.has(id))
  if (dropped.length === 0) return evicted

  return [...evicted.filter(id => !dropped.includes(id)), ...dropped].slice(-max)
}
