import { type EndStatus, type ItemPatch, mergeItem, type NewItem, type RabeItem } from './model'

export const MAX_ENDED = 200

export type Change = (items: RabeItem[]) => RabeItem[]

function replace(items: RabeItem[], index: number, next: RabeItem): RabeItem[] {
  if (JSON.stringify(items[index]) === JSON.stringify(next)) return items

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

export function commit(held: RabeItem[] | undefined, change: Change): RabeItem[] | undefined {
  const items = held ?? []
  const next = capEnded(change(items))

  return next === items ? undefined : next
}
