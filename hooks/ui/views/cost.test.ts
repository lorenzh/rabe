import { expect, test } from 'claude-code/testing'

import type { RabeTurn } from '../../../types'
import type { RabeItem } from '../../model'
import { cell, lines } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { ALL, explore, NOW, plan, review, verify } from '../fixtures'
import { type Model, NO_SELECTION, type Size } from '../view'
import { costView } from './cost'

const SIZE: Size = { columns: 80, rows: 24, surface: 'terminal', hasInput: false }
const MODEL: Model = { items: ALL, turns: {}, lines: {}, now: NOW, usd: 0.41 }

const row = (shown: string[], pattern: RegExp) => shown.findIndex(line => pattern.test(line))

test('the cost tab heads with the session cost, the totals and the running count', () => {
  const { grid } = costView(MODEL, SIZE, NO_SELECTION)
  const shown = lines(grid)
  expect(shown[0]).toBe(
    ' ≈ $0.41 session  claude $0.16   codex $0.09   tokens 91k   running 7   2 n/a',
  )
  expect(cell(grid, 1, 0)).toEqual(['≈'.codePointAt(0), C.bright, C.panel])
  expect(cell(grid, 79, 0)[2]).toBe(C.panel)
  expect(shown[2]).toBe('by worker · sorted by tokens')
  expect(shown[3]).toMatch(/^ {2}NAME +TOKENS +COST +TIME$/)
})

test('without the session cost the head says n/a, never $0.00', () => {
  const shown = lines(costView({ ...MODEL, usd: undefined }, SIZE, NO_SELECTION).grid)
  expect(shown[0]).toMatch(/^ session cost n\/a {2}claude/)
})

test('each worker has a block bar by tokens in its kind color, and n/a where unknown', () => {
  const { grid } = costView(MODEL, SIZE, NO_SELECTION)
  const shown = lines(grid)
  const top = row(shown, /Explore verifyToken/)
  expect(shown[top]).toMatch(/^▌◐ Explore verifyToken +█+ +41k +\$0\.16 +1m$/)
  const x = shown[top]?.indexOf('█') ?? -1
  expect(cell(grid, x, top)[1]).toBe(CHIP.agent.fg)
  expect(cell(grid, 0, top)[2]).toBe(C.selected)
  const codex = row(shown, /review auth\.ts/)
  expect(cell(grid, x, codex)[1]).toBe(CHIP.codex.fg)
  expect(shown[row(shown, /Plan auth split/)]).toMatch(/ ✓ Plan auth split +▏ +n\/a +n\/a +4m$/)
  expect(shown).toContain(' shells, monitors and cron jobs use no tokens')
})

test('j and k move through the workers and enter opens one', () => {
  const sel = { ...NO_SELECTION, tab: 'cost' as const, selected: review.id }
  const drawn = costView(MODEL, SIZE, sel)
  const keys = Object.fromEntries(drawn.buttons.map(one => [one.key, one]))
  expect(keys.down?.action).toEqual({ type: 'select', id: verify.id })
  expect(keys.up?.action).toEqual({ type: 'select', id: explore.id })
  expect(keys.open?.action).toEqual({ type: 'open', id: review.id })
  expect(keys.open?.autoFocus).toBe(true)
  const shown = lines(drawn.grid)
  const at = row(shown, /review auth\.ts/)
  expect(shown[at]?.startsWith('▌')).toBe(true)
  expect(drawn.rows?.[at]).toEqual({
    key: `row:${review.id}`,
    action: { type: 'open', id: review.id },
  })
})

test('load notes name a long tool call and an agent with no step for a while', () => {
  const turns: Record<string, RabeTurn[]> = {
    [explore.id]: [{ index: 1, at: NOW - 180_000, text: '', tools: [{ name: 'Bash' }] }],
    [verify.id]: [{ index: 1, at: NOW - 6 * 60_000, text: 'Thinking.', tools: [] }],
  }
  const { grid } = costView({ ...MODEL, turns }, SIZE, NO_SELECTION)
  const shown = lines(grid)
  const load = shown.indexOf('LOAD')
  expect(load).toBeGreaterThan(0)
  expect(shown[load + 1]).toBe(' ◷ long tool  Explore verifyToken · in Bash for 3m00s')
  expect(shown[load + 2]).toBe(' ⚠ stuck  verify:db.ts · no step for 6m')
  expect(cell(grid, 1, load + 2)).toEqual(['⚠'.codePointAt(0), CHIP.shell.fg, CHIP.shell.bg])
})

test('with nothing slow the load section says so, and the foot names the sources', () => {
  const gone = { ...review, detail: { ...review.detail, isSessionMissing: true } } as RabeItem
  const items = ALL.map(item => (item.id === review.id ? gone : item))
  const shown = lines(costView({ ...MODEL, items }, SIZE, NO_SELECTION).grid)
  expect(shown[shown.indexOf('LOAD') + 1]).toBe(' Nothing looks stuck.')
  expect(shown.at(-1)).toBe('session cost as /cost totals it · n/a: a Codex session file is gone')
})

test('the cost tab fits narrow widths and few rows', () => {
  const size = { ...SIZE, columns: 40, rows: 12 }
  const { grid } = costView({ ...MODEL, items: [...ALL, plan] }, size, NO_SELECTION)
  expect(grid.columns).toBe(40)
  expect(grid.rows).toBeLessThanOrEqual(12)
  expect(lines(grid).some(line => line.includes('Explore'))).toBe(true)
})
