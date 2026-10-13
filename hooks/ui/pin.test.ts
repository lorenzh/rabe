import { expect, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { dev, NOW } from './fixtures'
import { follow, type Geometry, geometry, NO_PIN } from './pin'
import type { Selection } from './view'

const geo: Geometry = { above: 4, rows: 10, total: 50, focus: [0, 1], split: 5, key: 'row:x' }

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
