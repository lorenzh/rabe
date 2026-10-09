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
// `requested`: the element the move asked for; `key`: where the ring landed.
const focus = (
  key: string,
  byPerson = true,
  isLiveRow = key.startsWith('row:'),
  requested = key,
  selected = key.startsWith('row:') ? key.slice(4) : 'a',
) => ({ type: 'focus', byPerson, key, requested, isLiveRow, selected }) as const

test('the pane starts disarmed, and only evidence of a safe ring arms it', () => {
  expect(DISARMED.isArmed).toBe(false)
  const armed = arm(DISARMED, { type: 'landed', isMoved: true })
  expect(armed.isArmed).toBe(true)
  expect(arm(armed, { type: 'reset' }).isArmed).toBe(false)
  expect(arm(armed, { type: 'landed', isMoved: false }).isArmed).toBe(false)
  expect(arm(DISARMED, focus('stop:shell:a')).isArmed).toBe(true)
  expect(arm(DISARMED, focus('row:shell:a', false)).isArmed).toBe(true)
  expect(arm(DISARMED, focus('stop:shell:a', false)).isArmed).toBe(false)
  expect(arm(armed, focus('delete:cron:a', false)).isArmed).toBe(true)
})

// GPT review round 7: the list's x and g act on the selection, which only a
// live row the person focused names; a landing, a header, a tab, a control
// or a gone slot is no such evidence.
test("the list's x and g arm only on the person's focus on a live row", () => {
  const landed = arm(DISARMED, { type: 'landed', isMoved: true })
  expect([landed.isArmed, landed.isListArmed]).toEqual([true, false])
  expect(arm(landed, focus('row:a', false)).isListArmed).toBe(false)
  for (const key of ['tab-items', 'group-shells', 'find', 'stop', 'stop-group']) {
    expect([key, arm(landed, focus(key)).isListArmed]).toEqual([key, false])
  }
  expect(arm(landed, focus('row:a', true, false)).isListArmed).toBe(false)
  const live = arm(landed, focus('row:a'))
  expect(live.isListArmed).toBe(true)
  expect(arm(live, focus('group-shells')).isListArmed).toBe(true)
  expect(arm(live, focus('row:gone', true, false)).isListArmed).toBe(false)
  expect(arm(live, { type: 'landed', isMoved: false }).isListArmed).toBe(false)
  expect(arm(live, { type: 'reset' }).isListArmed).toBe(false)
})

// GPT review round 8: in a pane taller than its body the arrow hook carries out
// the person's arrow with Rabe's own `$.ui.focus`, which arrives as a plugin's
// focus. Fed as pane.tsx feeds it, that move is the person's.
test('an arrow Rabe carries out arms x and g on a live row, and only that move', () => {
  const step = (key: string) => ({ type: 'step', key }) as const
  const moved = { type: 'landed', isMoved: true } as const
  const arrow = (from: typeof DISARMED, key: string, isLiveRow = true, isMoved = true) =>
    arm(arm(arm(from, step(key)), focus(key, false, isLiveRow)), { type: 'landed', isMoved })
  const landed = arm(arm(DISARMED, { type: 'reset' }), moved)
  const live = arrow(landed, 'row:a')
  expect([live.isArmed, live.isListArmed]).toEqual([true, true])
  // A row gone meanwhile, a move that lands elsewhere, a refused one.
  expect(arrow(landed, 'row:a', false).isListArmed).toBe(false)
  expect(arm(arm(landed, step('row:a')), focus('group-shells', false)).isListArmed).toBe(false)
  expect(arm(arm(landed, step('row:a')), focus('row:b', false)).isListArmed).toBe(false)
  expect(arrow(landed, 'row:a', true, false).isListArmed).toBe(false)
  // The step lasts one move: a landing after it is Rabe's, also onto that row.
  for (const after of [moved, { type: 'landed', isMoved: false }, { type: 'reset' }] as const) {
    const later = arm(arm(arm(landed, step('row:a')), after), focus('row:a', false))
    expect([after.type, later.isListArmed]).toEqual([after.type, false])
  }
  const elsewhere = arm(arm(landed, step('row:a')), focus('group-shells', false))
  expect(arm(elsewhere, focus('row:a', false)).isListArmed).toBe(false)
})

// GPT review round 9: a hook beneath Rabe's sends the move onto another
// element. The ring lands there, which the person did not choose.
test('a move another hook sends elsewhere never arms x and g', () => {
  const landed = arm(DISARMED, { type: 'landed', isMoved: true })
  const live = arm(landed, focus('row:a'))
  expect(arm(live, focus('row:c', true, true, 'row:b')).isListArmed).toBe(false)
  expect(arm(live, focus('group-shells', true, false, 'row:b')).isListArmed).toBe(false)
  expect(arm(live, focus('stop:shell:a', true, false, 'row:b')).isArmed).toBe(false)
  // Rabe's arrow onto row b lands on row c: pane.tsx feeds the call as not moved.
  const sent = arm(arm(live, { type: 'step', key: 'row:b' }), focus('row:c', false, true, 'row:b'))
  expect(sent.isListArmed).toBe(false)
  const after = arm(sent, { type: 'landed', isMoved: false })
  expect([after.isArmed, after.isListArmed]).toEqual([false, false])
  // The stored selection must name the row the ring landed on.
  expect(arm(landed, focus('row:a', true, true, 'row:a', 'b')).isListArmed).toBe(false)
  expect(arm(live, focus('row:a', true, true, 'row:a', 'b')).isListArmed).toBe(false)
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
  expect(arm(moved, focus('row:a')).isArmed).toBe(true)
})

// Shell a selected, then gone: the list falls back to b. Shift+Tab to the
// group header and Tab back to `gone a` must not let x stop b.
test('while the selection falls back, x and g stay inert until the person focuses a live row', () => {
  let state = arm(arm(DISARMED, shown('', ['x a'])), focus('row:a'))
  expect(arm(state, shown('', ['x a'])).isListArmed).toBe(true)
  state = arm(state, shown('selected:a', ['x b']))
  expect(state.isListArmed).toBe(false)
  for (const one of [focus('group-shells'), focus('row:a', true, false)]) {
    state = arm(arm(state, one), shown('selected:a', ['x b']))
    expect([one.key, state.isArmed, state.isListArmed]).toEqual([one.key, true, false])
  }
  const live = arm(arm(state, focus('row:b')), shown('', ['x b'], 'b'))
  expect(live.isListArmed).toBe(true)
  const open = arm(arm(DISARMED, shown('open:a selected:a')), focus('row:a', true, false))
  expect(arm(open, shown('open:a selected:a')).isListArmed).toBe(false)
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
