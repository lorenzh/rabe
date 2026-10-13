import {
  type EndStatus,
  type ItemPatch,
  isEnded,
  mergeItem,
  type NewItem,
  type RabeItem,
} from './model'

export const MAX_ENDED = 200
// Ended foreground Bash rows (`shell:fg-…`) kept; they go before any other ended item.
export const MAX_FOREGROUND = 50

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
  if (!item || isEnded(item)) return items

  return updateItem(items, id, { status, endedAt: now })
}

const isForeground = (item: RabeItem) => item.id.startsWith('shell:fg-')
const byEnd = (a: RabeItem, b: RabeItem) => (a.endedAt ?? a.seenAt) - (b.endedAt ?? b.seenAt)

// Ended foreground rows go first, the oldest first, and never more than
// MAX_FOREGROUND stay. Of two other items that ended at once, the one Rabe saw
// later goes first.
export function capEnded(items: RabeItem[], max = MAX_ENDED): RabeItem[] {
  const ended = items.filter(isEnded)
  const foreground = ended.filter(isForeground)
  const count = Math.max(ended.length - max, foreground.length - MAX_FOREGROUND)
  if (count <= 0) return items
  const order = [
    ...foreground.toSorted(byEnd),
    ...ended
      .filter(item => !isForeground(item))
      .toReversed()
      .toSorted(byEnd),
  ]
  const dropped = new Set(order.slice(0, count))

  return items.filter(item => !dropped.has(item))
}

// The end time of an ended item Rabe did not watch end: the oldest end held,
// so it never pushes out one Rabe watched. `undefined` once the cap is full,
// since the cap would drop it.
export function pastEnd(items: RabeItem[], now: number, max = MAX_ENDED): number | undefined {
  const ends = items.flatMap(item => (isEnded(item) ? [item.endedAt ?? item.seenAt] : []))

  return ends.length >= max ? undefined : Math.min(now, ...ends)
}

// The capped list and the ids the write drops (also one it added), or
// `undefined` when the capped list is the held one.
export function commit(
  held: RabeItem[] | undefined,
  change: Change,
): { items: RabeItem[]; dropped: string[] } | undefined {
  const items = held ?? []
  const changed = change(items)
  const next = capEnded(changed)
  if (next.length === items.length && next.every((item, i) => item === items[i])) return undefined
  const kept = new Set(next.map(item => item.id))
  const dropped = new Set([...items, ...changed].map(item => item.id).filter(id => !kept.has(id)))

  return { items: next, dropped: [...dropped] }
}

// `record` without the entries of `dropped` ids that are not back in `items`;
// the same record when none goes.
export function prune<T>(
  record: Record<string, T>,
  dropped: string[],
  items: RabeItem[],
): Record<string, T> {
  const gone = dropped.filter(id => id in record && !items.some(item => item.id === id))
  if (gone.length === 0) return record

  return Object.fromEntries(Object.entries(record).filter(([id]) => !gone.includes(id)))
}

// A poll stages changes; event hooks still write immediately.
export type Poll = { items: RabeItem[]; changes: Change[] }

export function stage(poll: Poll, change: Change): void {
  poll.changes.push(change)
  poll.items = capEnded(change(poll.items))
}

export function changeOf(poll: Poll, start: RabeItem[]): Change {
  return items =>
    items === start
      ? poll.items
      : poll.changes.reduce((list, change) => capEnded(change(list)), items)
}
