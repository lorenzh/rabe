import { expect, test } from 'claude-code/testing'

import type { RabePrevious } from '../../../types'
import { cell, lines } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { ALL, babysit, dev, lint, NOW, plan } from '../fixtures'
import { type Model, NO_SELECTION, type Size } from '../view'
import { timelineView } from './timeline'

const SIZE: Size = { columns: 100, rows: 40, surface: 'terminal', hasInput: false }
const MODEL: Model = { items: ALL, turns: {}, lines: {}, now: NOW }

const yesterday = new Date(2026, 9, 7, 17, 40).getTime()
const PREVIOUS: RabePrevious = {
  endedAt: yesterday,
  startedAt: yesterday - 72 * 60_000,
  counts: { agent: 6, codex: 2, shell: 4, cron: 1 },
  tokens: 800_000,
  usd: 0.32,
  failed: ['migrate.ts agent'],
}

const find = (shown: string[], text: string) => shown.findIndex(line => line.includes(text))

test('the timeline heads with the window, a color legend and a time axis', () => {
  const { grid } = timelineView(MODEL, SIZE, NO_SELECTION)
  const shown = lines(grid)
  expect(shown[0]).toBe('WHEN DID THINGS RUN?  this session, last 40 min')
  expect(shown[1]).toBe(' shell   claude   codex   monitor   cron run   done   failed')
  expect(cell(grid, 1, 1)).toEqual(['s'.codePointAt(0), CHIP.shell.fg, CHIP.shell.bg])
  expect(cell(grid, 9, 1)).toEqual(['c'.codePointAt(0), CHIP.agent.fg, CHIP.agent.bg])
  expect(shown[3]).toMatch(/^ +10:22 +10:32 +10:42 +now$/)
  expect(shown[3]?.length).toBe(100)
})

test('each item gets a bar over its run, colored by kind while it runs, then by its end', () => {
  const { grid } = timelineView(MODEL, SIZE, NO_SELECTION)
  const shown = lines(grid)
  const first = find(shown, 'bun run dev')
  expect(first).toBe(4)
  expect(shown[first]).toMatch(/^▌bun run dev :5173 +█+$/)
  expect(cell(grid, 0, first)[2]).toBe(C.selected)
  expect(cell(grid, 99, first)[1]).toBe(CHIP.shell.fg)
  const failed = find(shown, 'bun run lint')
  expect(cell(grid, 99, failed)[1]).toBe(C.red)
  expect(cell(grid, 99, failed)[0]).toBe(' '.codePointAt(0))
  const done = find(shown, ' Plan auth split')
  const x = shown[done]?.indexOf('█') ?? -1
  expect(cell(grid, x, done)[1]).toBe(C.green)
})

test('a cron job draws one tick per run since Rabe saw it', () => {
  const { grid } = timelineView(MODEL, SIZE, NO_SELECTION)
  const shown = lines(grid)
  const at = find(shown, babysit.title)
  const ticks = (shown[at]?.match(/█/g) ?? []).length
  expect(ticks).toBe(6)
  expect(cell(grid, shown[at]?.indexOf('█') ?? 0, at)[1]).toBe(C.purple)
})

test('j, k and enter move through the bars and open one', () => {
  const sel = { ...NO_SELECTION, tab: 'timeline' as const, selected: babysit.id }
  const drawn = timelineView(MODEL, SIZE, sel)
  const keys = Object.fromEntries(drawn.buttons.map(one => [one.key, one.action]))
  expect(keys).toEqual({
    down: { type: 'select', id: plan.id },
    up: { type: 'select', id: dev.id },
    open: { type: 'open', id: babysit.id },
  })
  const at = find(lines(drawn.grid), babysit.title)
  expect(drawn.rows?.[at]).toEqual({
    key: `row:${babysit.id}`,
    action: { type: 'open', id: babysit.id },
  })
})

test('who started what sits beside the previous session on a wide pane', () => {
  const { grid } = timelineView({ ...MODEL, previous: PREVIOUS }, SIZE, NO_SELECTION)
  const shown = lines(grid)
  const head = find(shown, 'WHO STARTED WHAT?')
  expect(shown[head]).toMatch(/^WHO STARTED WHAT\? {2}agents and their children +PREVIOUS SESSION$/)
  expect(shown[head + 1]).toMatch(/^main session +this project · ended yesterday 17:40$/)
  expect(shown[head + 2]).toMatch(/├─ ◐ Explore verifyToken +✓ 6 agents · 2 codex · 4 shells$/)
  expect(shown[head + 3]).toMatch(/├─ ✓ Plan auth split +≈ \$0\.32 · 800k tok · 1h12m$/)
  expect(shown[head + 4]).toMatch(/├─ ◐ review auth\.ts \(codex\) +✗ failed migrate\.ts agent$/)
  expect(shown[head + 5]).toMatch(
    /├─ ▶ bun run dev \(shell\) +⟳ 1 cron job ended with the session$/,
  )
  expect(shown.some(line => /^└─ ⧉ review-changes \(workflow\)$/.test(line))).toBe(true)
  expect(shown.some(line => /^ {3}└─ ✓ review:bugs$/.test(line))).toBe(true)
  expect(cell(grid, 60, head)[2]).toBe(C.raised)
})

test('on a narrow pane the previous session follows the tree; without one it says so', () => {
  const size = { ...SIZE, columns: 60, rows: 60 }
  const { grid } = timelineView(MODEL, size, NO_SELECTION)
  const shown = lines(grid)
  expect(grid.columns).toBe(60)
  const prev = find(shown, 'PREVIOUS SESSION')
  expect(prev).toBeGreaterThan(find(shown, 'review:bugs'))
  expect(shown[prev + 1]).toBe(' No earlier session with background work in this project.')
})

test('the timeline fits few rows and keeps the selected bar in view', () => {
  const sel = { ...NO_SELECTION, selected: lint.id }
  const { grid } = timelineView(MODEL, { ...SIZE, columns: 72, rows: 14 }, sel)
  expect(grid.rows).toBeLessThanOrEqual(14)
  expect(lines(grid).some(line => line.startsWith('▌bun run lint'))).toBe(true)
  expect(lines(grid)).toContain('WHO STARTED WHAT?  agents and their children')
})
