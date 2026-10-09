import { expect, test } from 'claude-code/testing'

import { arm, DISARMED, hash, isDestructive, landing, stepRow } from './view'

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

test('a view that falls back disarms once; a reset takes the fallback the next drawing shows', () => {
  const drawn = arm(DISARMED, { type: 'drawn', fallback: '' })
  const armed = arm(drawn, { type: 'landed', isMoved: true })
  const fell = arm(armed, { type: 'drawn', fallback: 'open:shell:a' })
  expect(fell.isArmed).toBe(false)
  const again = arm(arm(fell, { type: 'landed', isMoved: true }), {
    type: 'drawn',
    fallback: 'open:shell:a',
  })
  expect(again.isArmed).toBe(true)
  expect(arm(again, { type: 'drawn', fallback: '' }).isArmed).toBe(true)
  const reset = arm(armed, { type: 'reset' })
  const landed = arm(reset, { type: 'landed', isMoved: true })
  expect(arm(landed, { type: 'drawn', fallback: 'selected:file:/a.ts' }).isArmed).toBe(true)
  expect(arm(armed, { type: 'drawn', fallback: 'selected:shell:b' }).isArmed).toBe(false)
})

test('the keys of destructive controls are known by their prefix', () => {
  expect(
    ['stop:a', 'stop-group:shells:1x', 'stop-run:workflow:a', 'delete:cron:a'].map(isDestructive),
  ).toEqual([true, true, true, true])
  expect(['row:a', 'back', 'copy:a', 'message-agent:a', 'tab-items'].map(isDestructive)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ])
})

test('a hash names a list of ids in a key: the same list the same, another list another', () => {
  expect(hash(['a', 'b'])).toBe(hash(['a', 'b']))
  expect(hash(['a', 'b'])).not.toBe(hash(['a', 'c']))
  expect(hash(['ab'])).not.toBe(hash(['a', 'b']))
  expect(hash(['a', 'b'])).toMatch(/^[0-9a-z]+$/)
})
