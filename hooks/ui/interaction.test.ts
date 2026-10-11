import { expect, test } from 'claude-code/testing'
import { deferredFocus, IDLE, interact, isHeldBack, movedFocus } from './interaction'
import type { Piece } from './view'

const focus = (key: string, byPerson = true, isLiveRow = true) =>
  ({ type: 'focus', key, requested: key, byPerson, isLiveRow, selected: key.slice(4) }) as const
const draw = (isFocused = true, placement = 'dock', isShifted = false) =>
  ({
    type: 'draw',
    surface: 'terminal',
    isFocused,
    placement,
    scope: 'items',
    inPlace: true,
    pieces: (isShifted ? ['row:x', 'row:a', 'row:b'] : ['row:a', 'row:b']).map(key => ({
      spans: [{ key, label: key, action: { type: 'open', id: key.slice(4) } }],
    })) as Piece[],
  }) as const

test('the interaction starts disarmed and resets focus, regain and arming together', () => {
  let state = interact(IDLE, focus('row:a')).state
  state = interact(state, draw()).state
  state = interact(state, draw(true, 'dock', true)).state
  expect(state.shift?.key).toBe('row:a')
  const reset = interact(state, { type: 'reset' }).state
  expect(reset.arming.isArmed).toBe(false)
  expect(reset.ringOn).toBeUndefined()
  expect(reset.shift).toBeUndefined()
})

for (const [key, byPerson, isLiveRow, armed, listArmed] of [
  ['row:a', true, true, true, true],
  ['row:gone', true, false, true, false],
  ['row:a', false, true, true, false],
  ['stop:a', false, false, false, false],
  ['stop:a', true, false, true, false],
] as const) {
  test(`focus ${key}, person ${byPerson}, live ${isLiveRow} keeps the arming rules`, () => {
    const { state } = interact(IDLE, focus(key, byPerson, isLiveRow))
    expect([state.arming.isArmed, state.arming.isListArmed]).toEqual([armed, listArmed])
    expect(state.ringOn).toBe(key)
  })
}

test('regain is bounded, retries after refusal and becomes stale after a person moves', () => {
  let state = interact(interact(IDLE, focus('row:a')).state, draw()).state
  for (let i = 1; i <= 3; i++) {
    const result = interact(state, draw(true, 'dock', i === 1))
    state = result.state
    expect(result.effects).toEqual([{ type: 'regain', want: state.shift }])
    expect(state.shift?.tries).toBe(i)
    expect(isHeldBack(state, { surface: 'terminal', element: 'row:b' })).toBe(true)
    expect(isHeldBack(state, { surface: 'terminal', element: 'stop' })).toBe(false)
    state = interact(state, {
      type: 'regained',
      want: state.shift ?? { key: 'missing', isAsked: false, tries: 0 },
      isMoved: false,
    }).state
  }
  expect(interact(state, draw()).effects).toEqual([])
  const want = state.shift ?? { key: 'missing', isAsked: false, tries: 0 }
  state = interact(state, focus('row:b')).state
  expect(interact(state, { type: 'regained', want, isMoved: false }).state).toEqual(state)
  expect(isHeldBack(state, { surface: 'terminal', element: 'row:b' })).toBe(false)
})

test('a row that leaves above the ring asks a regain; the ring row itself only holds presses back', () => {
  let state = interact(interact(IDLE, focus('row:a')).state, draw(true, 'dock', true)).state
  const above = interact(state, draw())
  expect(above.state.shift?.key).toBe('row:a')
  expect(above.effects).toEqual([{ type: 'regain', want: above.state.shift }])
  state = interact(interact(IDLE, focus('row:x')).state, draw(true, 'dock', true)).state
  const own = interact(state, draw())
  expect(own.state.shift?.key).toBe('row:x')
  expect(own.effects).toEqual([])
  expect(isHeldBack(own.state, { surface: 'terminal', element: 'row:a' })).toBe(true)
  state = interact(interact(own.state, draw(false)).state, draw()).state
  expect(interact(own.state, draw(false)).effects).toEqual([])
  expect(interact(interact(own.state, draw(false)).state, draw()).effects).toEqual([])
  expect(interact(state, focus('row:a')).state.shift).toBeUndefined()
})

test('regain success leaves arming unchanged; a resize refocuses only a held pane', () => {
  let state = interact(interact(IDLE, focus('row:a')).state, draw()).state
  state = interact(state, draw(true, 'dock', true)).state
  state = interact(state, {
    type: 'regained',
    want: state.shift ?? { key: 'missing', isAsked: false, tries: 0 },
    isMoved: true,
  }).state
  expect(state.shift).toBeUndefined()
  expect(state.arming.isListArmed).toBe(true)
  expect(interact(state, draw(false, 'inline')).effects).toEqual([{ type: 'refocus', after: 500 }])
  state = interact(state, draw(false, 'inline')).state
  expect(interact(state, draw(false, 'dock')).effects).toEqual([])
})

test('an all-fit arrow behind back is relative to the landing in the new view', () => {
  let state = interact(IDLE, focus('back', false, false)).state
  state = interact(state, { type: 'press-start' }).state
  const oldKeys = ['tab-items', 'back', 'copy:a', 'stop:a']
  const pending = deferredFocus(state, oldKeys, 'copy:a')
  expect(pending).toEqual({ by: 1 })
  state = interact(state, { type: 'reset' }).state
  state = interact(state, focus('row:a', false)).state
  const newKeys = ['tab-items', 'find', 'row:a', 'row:b']
  expect(movedFocus(state, newKeys, pending ?? { by: 0 })).toBe('row:b')
  state = interact(state, { type: 'press-end' }).state
  expect(deferredFocus(state, newKeys, 'row:b')).toBeUndefined()
})

test('queued focus wraps like all-fit arrows and does not invent a move off an engine stop', () => {
  let state = interact(interact(IDLE, focus('row:b')).state, { type: 'press-start' }).state
  const keys = ['tab-items', 'row:a', 'row:b']
  expect(movedFocus(state, keys, { by: 1 })).toBe('tab-items')
  expect(deferredFocus(state, keys, undefined)).toEqual({ key: undefined })
  state = interact(state, { type: 'reset' }).state
  expect(movedFocus(state, keys, { key: undefined })).toBeUndefined()
})

test('focus evidence and a refused landing clear the one-shot arrow arming', () => {
  let state = interact(IDLE, { type: 'step', key: 'row:a' }).state
  state = interact(state, focus('row:a', false)).state
  expect(state.arming.isListArmed).toBe(true)
  state = interact(state, { type: 'focus-start', key: 'row:a' }).state
  expect(state.landedOn).toBeUndefined()
  state = interact(state, { type: 'landed', isMoved: false }).state
  expect(state.arming.isArmed).toBe(false)
  state = interact(state, focus('row:a', false)).state
  expect(state.arming.isListArmed).toBe(false)
})

test('opening clears the hold and keeps asking for keys only until the pane receives them', () => {
  let state = interact(IDLE, { type: 'opened' }).state
  expect(state.holds).toEqual({})
  state = interact(state, { type: 'refocused', isOpen: true, isFocused: false }).state
  expect(interact(state, draw(false)).effects).toEqual([{ type: 'refocus', after: 50 }])
  state = interact(state, draw()).state
  expect(interact(state, draw(false)).effects).toEqual([])
})

test('closing drops held slots and focus evidence without losing pending press counts', () => {
  let state = interact(IDLE, { type: 'opened' }).state
  state = interact(state, focus('row:a')).state
  state = interact(state, draw()).state
  state = interact(state, draw(true, 'dock', true)).state
  state = interact(state, { type: 'press-start' }).state
  const closed = interact(state, { type: 'closed' })
  expect(closed.state).toEqual({ ...IDLE, pressing: 1 })
  expect(closed.effects).toEqual([])
  expect(interact(closed.state, { type: 'press-end' }).state.pressing).toBe(0)
})

test('an all-fit arrow computed at the safe tab survives delivery after the press ended', () => {
  let state = interact(IDLE, { type: 'press-start' }).state
  state = interact(state, focus('tab-items', false, false)).state
  state = interact(state, focus('row:a', false)).state
  state = interact(state, { type: 'press-end' }).state
  const keys = ['tab-items', 'tab-cost', 'find', 'row:a', 'row:b']
  expect(deferredFocus(state, keys, 'tab-cost')).toEqual({ by: 1 })
  expect(movedFocus(state, keys, { by: 1 })).toBe('row:b')
  state = interact(state, focus('row:b')).state
  expect(deferredFocus(state, keys, 'row:a')).toBeUndefined()
})

test('an autoFocus echo does not erase the safe-tab origin of a late arrow', () => {
  let state = interact(IDLE, { type: 'press-start' }).state
  state = interact(state, focus('tab-items', false, false)).state
  state = interact(state, focus('row:a', false)).state
  state = interact(state, { type: 'press-end' }).state
  state = interact(state, focus('row:a', false)).state
  expect(
    deferredFocus(state, ['tab-items', 'tab-cost', 'find', 'row:a', 'row:b'], 'tab-cost'),
  ).toEqual({
    by: 1,
  })
})

test('a carried person arrow consumes the remembered landing origin', () => {
  let state = interact(IDLE, focus('tab-items', false, false)).state
  state = interact(state, focus('row:a', false)).state
  state = interact(state, { type: 'step', key: 'row:b' }).state
  state = interact(state, focus('row:b', false)).state
  expect(state.landingFrom).toBeUndefined()
  expect(state.arming.isListArmed).toBe(true)
})

test('an all-fit arrow received during the safe-tab detour keeps its direction', () => {
  let state = interact(IDLE, focus('tab-cost', false, false)).state
  state = interact(state, { type: 'press-start' }).state
  state = interact(state, { type: 'reset' }).state
  const keys = ['tab-items', 'tab-cost', 'tab-effects', 'tab-timeline']
  expect(deferredFocus(state, keys, 'tab-effects')).toEqual({ by: 1 })
  state = interact(state, { type: 'focus-start', key: 'tab-items' }).state
  expect(deferredFocus(state, keys, 'tab-cost')).toEqual({ by: 1 })
  state = interact(state, focus('tab-items', false, false)).state
  state = interact(state, focus('row:a', false)).state
  expect(movedFocus(state, [...keys, 'find', 'row:a', 'row:b'], { by: 1 })).toBe('row:b')
})
