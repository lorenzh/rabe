import { expect, test } from 'claude-code/testing'

import type { RabePrevious } from '../../../types'
import { cell, lines } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { ALL, babysit, dev, gridOf, lint, NOW, plan } from '../fixtures'
import { isPress, type Model, NO_SELECTION, rowKeys, type Size } from '../view'
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
  const { grid } = gridOf(timelineView(MODEL, SIZE, NO_SELECTION))
  const shown = lines(grid)
  expect(shown[0]).toBe('WHEN DID THINGS RUN?  this session, last 40 min')
  expect(shown[1]).toBe(' shell   claude   codex   monitor   cron run   done   failed')
  expect(cell(grid, 1, 1)).toEqual(['s'.codePointAt(0), CHIP.shell.fg, CHIP.shell.bg])
  expect(cell(grid, 9, 1)).toEqual(['c'.codePointAt(0), CHIP.agent.fg, CHIP.agent.bg])
  expect(shown[3]).toMatch(/^ +10:20 +10:30 +10:40 +now$/)
  expect(shown[3]?.length).toBe(100)
})

// A short window drew the same minute twice (`14:44  14:44`): the labels
// sit on round times spaced for the window, each one once.
test('the time axis names each clock time once, in order, before now', () => {
  for (const seconds of [61, 75, 90, 130, 200, 299, 600, 2400, 7300, 30_000]) {
    for (const columns of [40, 60, 100, 160]) {
      for (const at of [0, 5_000, 35_000]) {
        const now = NOW + at
        const items = [{ ...dev, startedAt: now - seconds * 1000 }]
        const model = { ...MODEL, items, now }
        const axis = lines(gridOf(timelineView(model, { ...SIZE, columns }, NO_SELECTION)).grid)[3]
        const labels = axis?.match(/\d\d:\d\d/g) ?? []
        const shown = [seconds, columns, at, axis]
        expect([...shown, new Set(labels).size]).toEqual([...shown, labels.length])
        expect([...shown, [...labels].sort()]).toEqual([...shown, labels])
        expect([...shown, axis?.trimEnd().endsWith(' now')]).toEqual([...shown, true])
      }
    }
  }
})

test('each item gets a bar over its run, colored by kind while it runs, then by its end', () => {
  const { grid } = gridOf(timelineView(MODEL, SIZE, NO_SELECTION))
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

test('a long name is cut and keeps a space before its bar', () => {
  const long = { ...dev, title: 'python3 -u -m http.server 4173', startedAt: NOW - 39 * 60_000 }
  const shown = lines(gridOf(timelineView({ ...MODEL, items: [long] }, SIZE, NO_SELECTION)).grid)
  expect(shown[4]).toMatch(/^▌python3 -u -m http\.se… █+$/)
})

test('a cron job draws one tick per run since Rabe saw it', () => {
  const { grid } = gridOf(timelineView(MODEL, SIZE, NO_SELECTION))
  const shown = lines(grid)
  const at = find(shown, babysit.title)
  const ticks = (shown[at]?.match(/█/g) ?? []).length
  expect(ticks).toBe(6)
  expect(cell(grid, shown[at]?.indexOf('█') ?? 0, at)[1]).toBe(CHIP.cron.fg)
})

test('a deleted cron job draws no ticks after it ended', () => {
  const stopped = { ...babysit, status: 'stopped' as const, endedAt: NOW - 16 * 60_000 }
  const model = { ...MODEL, items: ALL.map(item => (item === babysit ? stopped : item)) }
  const shown = lines(gridOf(timelineView(model, SIZE, NO_SELECTION)).grid)
  const at = find(shown, babysit.title)
  expect((shown[at]?.match(/█/g) ?? []).length).toBe(3)
})

test('each bar row is a Button that opens it, in the order the pane opened with', () => {
  const sel = { ...NO_SELECTION, tab: 'timeline' as const, selected: babysit.id }
  const drawn = gridOf(timelineView(MODEL, SIZE, sel))
  expect(drawn.buttons).toEqual([])
  const rows = drawn.nodes.flatMap(node => ('spans' in node ? node.spans.filter(isPress) : []))
  const own = rows.find(one => one.key === `row:${babysit.id}`)
  expect(own).toMatchObject({ label: babysit.title, autoFocus: true })
  expect(own?.action).toEqual({ type: 'open', id: babysit.id })
  const held = timelineView(MODEL, SIZE, { ...sel, order: { timeline: [plan.id] } })
  expect(rowKeys(held)[0]).toBe(`row:${plan.id}`)
})

test('who started what sits beside the previous session on a wide pane', () => {
  const { grid } = gridOf(timelineView({ ...MODEL, previous: PREVIOUS }, SIZE, NO_SELECTION))
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
  const { grid } = gridOf(timelineView(MODEL, size, NO_SELECTION))
  const shown = lines(grid)
  expect(grid.columns).toBe(60)
  const prev = find(shown, 'PREVIOUS SESSION')
  expect(prev).toBeGreaterThan(find(shown, 'review:bugs'))
  expect(shown[prev + 1]).toBe(' No earlier session with background work in this project.')
})

test('the timeline draws every bar; the pane scrolls what is below its body', () => {
  const sel = { ...NO_SELECTION, selected: lint.id }
  const { grid } = gridOf(timelineView(MODEL, { ...SIZE, columns: 72, rows: 14 }, sel))
  expect(lines(grid).some(line => line.startsWith('▌bun run lint'))).toBe(true)
  expect(lines(grid)).toContain('WHO STARTED WHAT?  agents and their children')
})

test('the previous session names its id, and c copies the command that resumes it', () => {
  const sessionId = '5f1c0d2e-7a7b-4c1d-9e2f-0123456789ab'
  const drawn = timelineView({ ...MODEL, previous: { ...PREVIOUS, sessionId } }, SIZE, NO_SELECTION)
  const shown = lines(gridOf(drawn).grid)
  expect(shown[find(shown, ' id ')]).toMatch(new RegExp(` id ${sessionId}$`))
  expect(drawn.buttons).toEqual([
    {
      key: `resume:${sessionId}`,
      label: 'c: copy resume',
      hotkey: 'c',
      action: { type: 'copy', text: `claude --resume ${sessionId}` },
    },
  ])
  const old = timelineView({ ...MODEL, previous: PREVIOUS }, SIZE, NO_SELECTION)
  const before = lines(gridOf(old).grid)
  expect(before[find(before, ' id ')]).toMatch(/ id n\/a$/)
  expect(old.buttons).toEqual([])
})
