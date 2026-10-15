import { expect, test } from 'claude-code/testing'

import type { RabeTurn } from '../../../types'
import type { RabeItem } from '../../model'
import { cell, lines } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { ALL, explore, gridOf, NOW, plan, review, reviewed, verify } from '../fixtures'
import { isPress, type Model, NO_SELECTION, rowKeys, type Size } from '../view'
import { costView } from './cost'

const SIZE: Size = { columns: 80, rows: 24, surface: 'terminal', hasInput: false }
const MODEL: Model = { items: ALL, turns: {}, lines: {}, now: NOW, usd: 0.41 }

const row = (shown: string[], pattern: RegExp) => shown.findIndex(line => pattern.test(line))

test('the cost tab heads with the session cost, the totals and the running count', () => {
  const { grid } = gridOf(costView(MODEL, SIZE, NO_SELECTION))
  const shown = lines(grid)
  expect(shown[0]).toBe(' ≈ $0.41 session  claude n/a  codex ≈ $0.09  tokens 91k  running 7  2 n/a')
  expect(cell(grid, 1, 0)).toEqual(['≈'.codePointAt(0), C.bright, C.panel])
  expect(cell(grid, 79, 0)[2]).toBe(C.panel)
  expect(shown[2]).toBe('by worker · sorted by tokens')
  expect(shown[3]).toMatch(/^ {2}NAME +TOKENS +COST +TIME$/)
})

test('cost names use more room and source totals without a source are hidden', () => {
  const size = { ...SIZE, columns: 100 }
  const long = { ...explore, title: 'Explore feature implementation' }
  const shown = lines(gridOf(costView({ ...MODEL, items: [long] }, size, NO_SELECTION)).grid)
  expect(shown[0]).toContain('claude')
  expect(shown[0]).not.toContain('codex')
  expect(shown.some(line => line.includes(long.title))).toBe(true)
})

test('without the session cost the head says n/a, never $0.00', () => {
  const shown = lines(gridOf(costView({ ...MODEL, usd: undefined }, SIZE, NO_SELECTION)).grid)
  expect(shown[0]).toMatch(/^ session cost n\/a {2}claude/)
})

test('each worker has a block bar by tokens in its kind color, and n/a where unknown', () => {
  const { grid } = gridOf(costView(MODEL, SIZE, NO_SELECTION))
  const shown = lines(grid)
  const top = row(shown, /Explore verifyToken/)
  expect(shown[top]).toMatch(/^▌◐ Explore verifyToken +█+ +41k +≈ \$0\.16 +1m$/)
  const x = shown[top]?.indexOf('█') ?? -1
  expect(cell(grid, x, top)[1]).toBe(CHIP.agent.fg)
  expect(cell(grid, 0, top)[2]).toBe(C.selected)
  const codex = row(shown, /review auth\.ts/)
  expect(cell(grid, x, codex)[1]).toBe(CHIP.codex.fg)
  expect(shown[row(shown, /Plan auth split/)]).toMatch(/ ✓ Plan auth split +▏ +n\/a +n\/a +4m$/)
  expect(shown).toContain(' shells, monitors and cron jobs use no tokens')
})

test('each worker row is a Button that opens it; the selected one takes the focus', () => {
  const sel = { ...NO_SELECTION, tab: 'cost' as const, selected: review.id }
  const drawn = gridOf(costView(MODEL, SIZE, sel))
  expect(drawn.buttons.map(one => one.key)).toEqual(['by-agent', 'by-model', 'by-harness'])
  const rows = drawn.nodes.flatMap(node => ('spans' in node ? node.spans.filter(isPress) : []))
  expect(rows.map(one => one.key)).toEqual(
    [explore, review, verify, plan, reviewed].map(item => `row:${item.id}`),
  )
  const own = rows.find(one => one.key === `row:${review.id}`)
  expect(own).toMatchObject({ label: 'review auth.ts', autoFocus: true })
  expect(own?.action).toEqual({ type: 'open', id: review.id })
  const shown = lines(drawn.grid)
  expect(shown[row(shown, /review auth\.ts/)]?.startsWith('▌')).toBe(true)
})

test('a held order keeps the workers in place as their tokens grow', () => {
  const order = { cost: [plan.id, verify.id] }
  const drawn = costView(MODEL, SIZE, { ...NO_SELECTION, order })
  expect(rowKeys(drawn)).toEqual(
    [plan, verify, explore, review, reviewed].map(item => `row:${item.id}`),
  )
  expect(lines(gridOf(drawn).grid)[2]).toBe('by worker · sorted by tokens when opened')
})

test('load notes name a long tool call and an agent with no step for a while', () => {
  const turns: Record<string, RabeTurn[]> = {
    [explore.id]: [{ index: 1, at: NOW - 180_000, text: '', tools: [{ name: 'Bash' }] }],
    [verify.id]: [{ index: 1, at: NOW - 6 * 60_000, text: 'Thinking.', tools: [] }],
  }
  const { grid } = gridOf(costView({ ...MODEL, turns }, SIZE, NO_SELECTION))
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
  const shown = lines(gridOf(costView({ ...MODEL, items }, SIZE, NO_SELECTION)).grid)
  expect(shown[shown.indexOf('LOAD') + 1]).toBe(' Nothing looks stuck.')
  expect(shown.at(-1)).toBe('session cost as /cost totals it · n/a: a Codex session file is gone')
})

test('the cost tab fits narrow widths; the pane scrolls what is below its body', () => {
  const size = { ...SIZE, columns: 40, rows: 12 }
  const { grid } = gridOf(costView({ ...MODEL, items: [...ALL, plan] }, size, NO_SELECTION))
  expect(grid.columns).toBe(40)
  expect(lines(grid).some(line => line.includes('Explore'))).toBe(true)
})

test('the head names this session, and c copies the command that resumes it', () => {
  const sessionId = '5f1c0d2e-7a7b-4c1d-9e2f-0123456789ab'
  const drawn = costView({ ...MODEL, sessionId }, SIZE, NO_SELECTION)
  expect(lines(gridOf(drawn).grid)[1]).toBe(` session ${sessionId}`)
  expect(drawn.buttons.filter(one => one.key.startsWith('resume:'))).toEqual([
    {
      key: `resume:${sessionId}`,
      label: 'c: copy resume',
      hotkey: 'c',
      action: { type: 'copy', text: `claude --resume ${sessionId}`, what: 'resume command' },
    },
  ])
  const none = costView(MODEL, SIZE, NO_SELECTION)
  expect(lines(gridOf(none).grid)[1]).toBe(' session n/a')
  expect(none.buttons.some(one => one.key.startsWith('resume:'))).toBe(false)
})

test('an agent that only forwarded to Codex adds its tokens to the job and has no row', () => {
  const call = { at: NOW - 60_000, command: 'task' as const, text: 'codex-companion.mjs task' }
  const forwarder = {
    ...explore,
    id: 'agent:f1',
    title: 'Codex rescue',
    tokens: { input: 4_000, output: 1_000 },
    detail: { agentId: 'f1', toolCount: 1, codexCalls: [call] },
  } as RabeItem
  const job = { ...review, parentId: forwarder.id } as RabeItem
  const drawn = costView({ ...MODEL, items: [forwarder, job] }, SIZE, NO_SELECTION)
  expect(rowKeys(drawn)).toEqual([`row:${job.id}`])
  const shown = lines(gridOf(drawn).grid)
  expect(shown[row(shown, /review auth\.ts/)]).toMatch(/ 33k +≈ \$0\.25/)
})

// Issue #206: a removed worker keeps its row, so the rows add up to the
// totals.
test('a removed worker keeps its row on the cost tab and in the totals', () => {
  const drawn = gridOf(costView({ ...MODEL, removed: [plan.id, review.id] }, SIZE, NO_SELECTION))
  expect(rowKeys(drawn)).toContain(`row:${plan.id}`)
  expect(rowKeys(drawn)).toContain(`row:${review.id}`)
  expect(rowKeys(drawn)).toContain(`row:${explore.id}`)
  expect(lines(drawn.grid)[0]).toContain('codex ≈ $0.09  tokens 91k')
})

test('idle stays readable when a long agent name is cut on every surface', () => {
  const idle: RabeItem = { ...plan, title: 'scout '.repeat(20), status: 'idle', endedAt: undefined }
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const columns of [40, 80]) {
      const drawn = costView(
        { ...MODEL, items: [idle] },
        { ...SIZE, columns, surface },
        NO_SELECTION,
      )
      const labels = drawn.nodes.flatMap(node =>
        'spans' in node ? node.spans.filter(isPress) : [],
      )
      const own = labels.find(one => one.key === `row:${idle.id}`)
      expect(own?.label).toContain('idle')
      expect(lines(gridOf(drawn).grid).join(' ')).toContain('◷')
    }
  }
})

test('the model grouping draws a row per model and the main session apart, partial', () => {
  const main = { 'claude-opus-5-5': { steps: 3, input: 1000, output: 200, cached: 500, usd: 0.5 } }
  const sel = { ...NO_SELECTION, grouping: 'model' as const }
  const drawn = costView({ ...MODEL, mainUsage: main }, SIZE, sel)
  const shown = lines(gridOf(drawn).grid)
  expect(shown[2]).toBe('by model · sorted by tokens')
  expect(shown[3]).toMatch(/WORKERS$/)
  const at = row(shown, /opus-5-5 .*41k +≈ \$0\.16 +1$/)
  expect(at).toBeGreaterThan(3)
  expect(
    shown.some(line => /main session · opus-5-5 .*\(partial\).*1k +≈ \$0\.50/.test(line)),
  ).toBe(true)
  expect(rowKeys(drawn)).toContain('row:by:model:main:claude-opus-5-5')
  expect(shown.some(line => line.includes('model n/a'))).toBe(true)
})

test('a group total that leaves workers out says partial in words', () => {
  const sel = { ...NO_SELECTION, grouping: 'harness' as const }
  const shown = lines(gridOf(costView({ ...MODEL, items: [explore, plan] }, SIZE, sel)).grid)
  expect(shown.some(line => /Claude Code \(partial\) .*41k/.test(line))).toBe(true)
})

test('the main session row keeps (partial) visible at every width and grouping', () => {
  const main = { 'claude-opus-5-5': { steps: 3, input: 1000, output: 200, cached: 500, usd: 0.5 } }
  for (const grouping of ['agent', 'model', 'harness'] as const) {
    for (const columns of [30, 40, 50, 80]) {
      const sel = { ...NO_SELECTION, grouping } as typeof NO_SELECTION
      const drawn = costView({ ...MODEL, mainUsage: main }, { ...SIZE, columns }, sel)
      const labels = drawn.nodes.flatMap(node =>
        'spans' in node ? node.spans.filter(isPress) : [],
      )
      const own = labels.find(one => one.key.includes(':main'))
      expect(own?.label, `${grouping} ${columns}`).toContain('(partial)')
    }
  }
})

test('partial rows stay distinguishable at narrow widths', () => {
  const main = {
    'claude-opus-5-5': { steps: 3, input: 1000, output: 200, cached: 500, usd: 0.5 },
    'claude-sonnet-5-5': { steps: 2, input: 900, output: 100, cached: 0, usd: 0.3 },
  }
  for (const columns of [30, 40, 50]) {
    const sel = { ...NO_SELECTION, grouping: 'model' as const }
    const drawn = costView({ ...MODEL, items: [], mainUsage: main }, { ...SIZE, columns }, sel)
    const labels = drawn.nodes
      .flatMap(node => ('spans' in node ? node.spans.filter(isPress) : []))
      .filter(one => one.key.includes(':main'))
      .map(one => one.label)
    expect(labels.length, `${columns}`).toBe(2)
    expect(new Set(labels).size, `${columns} ${labels}`).toBe(2)
    for (const label of labels) {
      expect(label, `${columns}`).toContain('(partial)')
      expect(
        label.replace('(partial)', '').trim().length,
        `${columns} ${label}`,
      ).toBeGreaterThanOrEqual(6)
    }
  }
})

test('narrow group rows keep every value and a recognisable name, workers included', () => {
  const main = { 'claude-opus-5-5': { steps: 3, input: 1000, output: 200, cached: 500, usd: 0.5 } }
  const opus = {
    ...explore,
    id: 'o',
    detail: { ...explore.detail, model: 'claude-opus-5-5' },
  } as RabeItem
  const sonnet = {
    ...plan,
    id: 's',
    detail: { ...plan.detail, model: 'claude-sonnet-5-5' },
  } as RabeItem
  for (const columns of [30, 40, 50]) {
    for (const grouping of ['model', 'harness'] as const) {
      const sel = { ...NO_SELECTION, grouping }
      const size = { ...SIZE, columns }
      const shown = lines(
        gridOf(costView({ ...MODEL, items: [opus, sonnet], mainUsage: main }, size, sel)).grid,
      )
      const at = `${grouping} ${columns} `
      expect(
        shown.some(line => /\b1k\b/.test(line)),
        at,
      ).toBe(true)
      expect(
        shown.some(line => /\$0\.50/.test(line)),
        at,
      ).toBe(true)
      if (grouping === 'model') {
        expect(
          shown.some(line => line.includes('opus-5-5 (partial)')),
          at,
        ).toBe(true)
        expect(
          shown.some(line => line.includes('sonnet-5-5')),
          at,
        ).toBe(true)
      }
    }
  }
})

test('a partial worker group and the main session row of one model read apart', () => {
  const main = { 'claude-opus-5-5': { steps: 3, input: 1000, output: 200, cached: 500, usd: 0.5 } }
  const known = {
    ...explore,
    id: 'k',
    detail: { ...explore.detail, model: 'claude-opus-5-5' },
  } as RabeItem
  const blind = { ...known, id: 'b', tokens: undefined } as RabeItem
  for (const columns of [30, 40, 50]) {
    const sel = { ...NO_SELECTION, grouping: 'model' as const }
    const drawn = costView(
      { ...MODEL, items: [known, blind], mainUsage: main },
      { ...SIZE, columns },
      sel,
    )
    const labels = drawn.nodes
      .flatMap(node => ('spans' in node ? node.spans.filter(isPress) : []))
      .filter(one => one.key.startsWith('row:by:'))
      .map(one => one.label)
    expect(labels.length, `${columns}`).toBe(2)
    expect(new Set(labels).size, `${columns} ${labels}`).toBe(2)
  }
})

test('long model names keep the partial marker and a distinguishing end', () => {
  const name = 'claude-opus-5-5-experimental-preview-build-'
  const main = {
    [`${name}a`]: { steps: 3, input: 1000, output: 200, cached: 500, usd: 0.5 },
    [`${name}b`]: { steps: 2, input: 900, output: 100, cached: 0, usd: 0.3 },
  }
  for (const columns of [30, 40, 50]) {
    const sel = { ...NO_SELECTION, grouping: 'model' as const }
    const drawn = costView({ ...MODEL, items: [], mainUsage: main }, { ...SIZE, columns }, sel)
    const labels = drawn.nodes
      .flatMap(node => ('spans' in node ? node.spans.filter(isPress) : []))
      .filter(one => one.key.includes(':main'))
      .map(one => one.label)
    expect(labels.length, `${columns}`).toBe(2)
    expect(new Set(labels).size, `${columns} ${labels}`).toBe(2)
    for (const label of labels) expect(label, `${columns}`).toContain('(partial)')
  }
})
