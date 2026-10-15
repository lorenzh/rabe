import { expect, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { dev, explore, NOW } from './fixtures'
import { follow, type Geometry, geometry, measure, NO_PIN } from './pin'
import { hold } from './render'
import { layout, type Selection } from './view'
import { paneView } from './views/pane'

const geo: Geometry = {
  above: 4,
  rows: 10,
  total: 50,
  focus: [0, 1],
  split: 5,
  key: 'row:x',
  floor: 0,
}

test('a new view starts at the top and brings the selected row into view', () => {
  expect(follow(NO_PIN, geo, 'a', dev.id)).toEqual({ top: 0, scope: 'a', followed: dev.id })
  expect(follow(NO_PIN, { ...geo, focus: [30, 1] }, 'a', 'x').top).toBe(21)
})

test('a redraw keeps the scroll; a new selected row moves it just enough', () => {
  const pin = { top: 12, scope: 'a', followed: 'x' }
  expect(follow(pin, { ...geo, focus: [3, 1] }, 'a', 'x').top).toBe(12)
  expect(follow(pin, { ...geo, focus: [3, 1] }, 'a', 'y').top).toBe(3)
  expect(follow(pin, { ...geo, focus: [30, 1] }, 'a', 'y').top).toBe(21)
})

test('the scroll stays inside the body', () => {
  expect(follow({ top: 99, scope: 'a', followed: 'x' }, geo, 'a', 'x').top).toBe(40)
  expect(follow({ top: -3, scope: 'a', followed: 'x' }, geo, 'a', 'x').top).toBe(0)
})

const shells = Array.from(
  { length: 28 },
  (_, at): RabeItem => ({
    ...dev,
    kind: 'shell',
    id: `shell:bg_${at}`,
    title: `sleep ${at}`,
    detail: { command: `sleep ${at}`, taskId: `bg_${at}`, outputPath: `/t/bg_${at}.output` },
  }),
)
const model = { items: shells, turns: {}, lines: {}, now: NOW }
const sel: Selection = {
  tab: 'items',
  query: '',
  folded: [],
  selected: shells[0]?.id ?? '',
  open: '',
  isFocused: true,
  isArmed: true,
  isListArmed: true,
}
const at = (rows: number) => ({ columns: 100, rows, surface: 'terminal', hasInput: true }) as const

test('a pane too short for the whole header pins only the tabs, so the list keeps 3 rows', () => {
  // 100x24 terminal: the pane body is 7 rows; the toolbar wraps to two rows.
  const fresh = geometry(model, at(7), sel)
  expect(fresh?.rows).toBeGreaterThanOrEqual(3)
  expect(fresh?.above).toBe(fresh?.head)
})

test('a pane with room for the whole header still pins all of it', () => {
  const fresh = geometry(model, at(12), sel)
  expect(fresh?.rows).toBeGreaterThanOrEqual(3)
  expect(fresh?.above).toBeGreaterThan(fresh?.head ?? 99)
})

test('a pane that leaves under 3 rows even for the tabs alone drops pinning', () => {
  expect(geometry(model, at(5), sel)).toBeUndefined()
})

test('a landing on a row of a tight pane leaves 3 list rows in view', () => {
  // body: 2 toolbar rows, search, group header, then the list from line 4.
  const tight: Geometry = { ...geo, above: 2, rows: 4, total: 40, focus: [4, 1], floor: 3 }
  expect(follow(NO_PIN, tight, 'a', 'x').top).toBe(3)
  // the person's own wheel scroll on a redraw is kept
  const own = { top: 0, scope: 'a', followed: 'x' }
  expect(follow(own, tight, 'a', 'x').top).toBe(0)
  // a toolbar button above the list is still scrolled into view
  const bar: Geometry = { ...tight, focus: [1, 1], key: 'delete' }
  expect(follow({ top: 3, scope: 'a', followed: 'y' }, bar, 'a', 'delete').top).toBe(1)
})

test('a wrapped toolbar button is focused on the row it stands on', () => {
  const button = (key: string) => ({ button: { key, label: key } }) as never
  const row = { spans: [{ key: 'row:x', label: 'x', action: { type: 'none' } }] }
  // a, b and c share the first toolbar row; d wraps onto the second.
  const list = [
    { spans: [['tabs', {}]] },
    button('a'),
    button('b'),
    button('c'),
    button('d'.repeat(30)),
    row,
    { spans: [] },
  ] as never
  const size = { columns: 40, rows: 7, surface: 'terminal', hasInput: true } as never
  expect(measure(list, 1, size, 'x', 'c', true).focus).toEqual([0, 1])
  expect(measure(list, 1, size, 'x', 'd'.repeat(30), true).focus).toEqual([1, 1])
})

test('a stacked cost group row scrolls into view with its numbers line', () => {
  // Eight model groups in a 40x15 Cost pane: each row stacks its numbers
  // under its name, and the pane must follow both lines of the selected row.
  const items = Array.from(
    { length: 8 },
    (_, at): RabeItem =>
      ({
        ...explore,
        id: `agent:m${at}`,
        tokens: { input: 1000 * (8 - at), output: 0 },
        detail: { ...explore.detail, agentId: `m${at}`, model: `claude-model-${at}-long-name` },
      }) as RabeItem,
  )
  const cost = { items, turns: {}, lines: {}, now: NOW }
  const size = { columns: 40, rows: 15, surface: 'terminal', hasInput: true } as const
  for (let at = 0; at < 8; at++) {
    const picked: Selection = {
      ...sel,
      tab: 'cost',
      grouping: 'model',
      selected: `by:model:claude-model-${at}-long-name`,
    }
    const fresh = geometry(cost, size, picked)
    expect(fresh, `${at}`).toBeDefined()
    if (!fresh) continue
    const list = hold(layout(paneView(cost, size, picked))).list
    const found = measure(list, fresh.head, size, picked.selected, undefined, fresh.isTight)
    expect(found.focus?.[1], `${at}`).toBe(2)
    const [row = 0, rows = 0] = found.focus ?? []
    const top = follow(NO_PIN, found, 'cost', found.key).top
    expect(row + rows, `${at}`).toBeLessThanOrEqual(top + found.rows)
  }
})
