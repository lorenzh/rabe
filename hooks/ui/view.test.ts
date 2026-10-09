import { expect, test } from 'claude-code/testing'

import { arm, DISARMED, isDestructive, landing, stepRow } from './view'

const KEYS = ['row:a', 'row:b', 'row:c']

test('an arrow steps to the next or previous row and stops at the ends', () => {
  expect(stepRow(KEYS, 'b', 1)).toBe('row:c')
  expect(stepRow(KEYS, 'b', -1)).toBe('row:a')
  expect(stepRow(KEYS, 'c', 1)).toBeUndefined()
  expect(stepRow(KEYS, 'a', -1)).toBeUndefined()
})

test('from no row, down goes to the first and up scrolls on', () => {
  expect(stepRow(KEYS, '', 1)).toBe('row:a')
  expect(stepRow(KEYS, 'gone', -1)).toBeUndefined()
  expect(stepRow([], '', 1)).toBeUndefined()
})

// The test kit cannot answer a plugin's $.ui.focus (see feasibility), so the
// keys `act` focuses after each change of the view are checked here.
test('a change of the view lands the focus ring on the active tab, then where it leads', () => {
  expect(landing({ type: 'tab', tab: 'cost' }, '')).toEqual(['tab-cost'])
  expect(landing({ type: 'tab', tab: 'items' }, 'shell:a')).toEqual(['tab-items'])
  expect(landing({ type: 'open', id: 'shell:a' }, '')).toEqual(['tab-items', 'back'])
  expect(landing({ type: 'open', id: '' }, 'shell:a')).toEqual(['tab-items', 'row:shell:a'])
  expect(landing({ type: 'open', id: '' }, '')).toEqual(['tab-items'])
  expect(landing({ type: 'fold', group: 'shells' }, '')).toEqual(['tab-items', 'group-shells'])
  expect(landing({ type: 'query', text: 'dev' }, '')).toEqual(['search'])
  expect(landing({ type: 'stop', ids: ['shell:a'] }, '')).toEqual([])
})

// Destructive controls act only while the ring is known to sit on a safe
// element (see arming in docs/architecture.md).
test('the pane starts disarmed, and only evidence of a safe ring arms it', () => {
  expect(DISARMED.isArmed).toBe(false)
  const armed = arm(DISARMED, { type: 'landed', isMoved: true })
  expect(armed.isArmed).toBe(true)
  expect(arm(armed, { type: 'reset' }).isArmed).toBe(false)
  expect(arm(armed, { type: 'landed', isMoved: false }).isArmed).toBe(false)
  expect(arm(DISARMED, { type: 'focus', byPerson: true, key: 'stop:shell:a' }).isArmed).toBe(true)
  expect(arm(DISARMED, { type: 'focus', byPerson: false, key: 'row:shell:a' }).isArmed).toBe(true)
  expect(arm(DISARMED, { type: 'focus', byPerson: false, key: 'stop:shell:a' }).isArmed).toBe(false)
  expect(arm(armed, { type: 'focus', byPerson: false, key: 'delete:cron:a' }).isArmed).toBe(true)
})

const shown = (fallback: string, targets: string[] = [], selected = 'a') =>
  ({ type: 'drawn', fallback, targets, selected }) as const

test('a view that falls back disarms once; a reset takes the fallback the next drawing shows', () => {
  const armed = arm(arm(DISARMED, shown('')), { type: 'landed', isMoved: true })
  const fell = arm(armed, shown('open:shell:a'))
  expect(fell.isArmed).toBe(false)
  const again = arm(arm(fell, { type: 'landed', isMoved: true }), shown('open:shell:a'))
  expect(again.isArmed).toBe(true)
  expect(arm(again, shown('')).isArmed).toBe(true)
  const landed = arm(arm(armed, { type: 'reset' }), { type: 'landed', isMoved: true })
  expect(arm(landed, shown('selected:file:/a.ts')).isArmed).toBe(true)
  expect(arm(armed, shown('selected:shell:b')).isArmed).toBe(false)
})

// The list's x and g act on the selection under one key each: a target that
// comes while the person did not move the selection disarms them.
test('a list target that comes without the person disarms; the next person focus re-arms', () => {
  const armed = arm(arm(DISARMED, shown('', ['x a', 'g a', 'g c'])), {
    type: 'landed',
    isMoved: true,
  })
  expect(arm(armed, shown('', ['x a', 'g a', 'g c'])).isArmed).toBe(true)
  expect(arm(armed, shown('', ['x a', 'g a'])).isArmed).toBe(true)
  expect(arm(armed, shown('', ['x b', 'g b'], 'b')).isArmed).toBe(true)
  expect(arm(armed, shown('', ['x a', 'g a', 'g c', 'g d'])).isArmed).toBe(false)
  const moved = arm(armed, shown('', ['x c', 'g a', 'g c']))
  expect(moved.isArmed).toBe(false)
  expect(arm(moved, { type: 'focus', byPerson: true, key: 'row:a' }).isArmed).toBe(true)
})

test('the keys of destructive controls are known by their prefix', () => {
  expect(
    ['stop', 'stop-group', 'stop:a', 'stop-run:workflow:a', 'delete:cron:a'].map(isDestructive),
  ).toEqual([true, true, true, true, true])
  expect(['row:a', 'back', 'copy:a', 'message-agent:a', 'tab-items'].map(isDestructive)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ])
})
