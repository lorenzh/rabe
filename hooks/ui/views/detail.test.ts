import { expect, test } from 'claude-code/testing'

import type { RabeItem } from '../../model'
import { cell, type Grid, lines } from '../cells/grid'
import { C } from '../cells/palette'
import { ALL, babysit, ci, dev, explore, flow, lint, NOW, review, verify } from '../fixtures'
import { type Model, NO_SELECTION, type Size } from '../view'
import { detailView } from './detail'
import { itemsView } from './items'

const TERMINAL: Size = { columns: 60, rows: 30, surface: 'terminal', hasInput: false }

function model(items: RabeItem[] = ALL, extra: Partial<Model> = {}): Model {
  return { items, turns: {}, lines: {}, now: NOW, ...extra }
}

function open(m: Model, id: string, size: Size = TERMINAL) {
  return detailView(m, size, { ...NO_SELECTION, open: id })
}

// The row and column where `text` starts.
function find(g: Grid, text: string): [x: number, y: number] {
  const shown = lines(g)
  const y = shown.findIndex(line => line.includes(text))
  if (y === -1) throw new Error(`"${text}" not in:\n${shown.join('\n')}`)

  return [shown[y]?.indexOf(text) ?? -1, y]
}

const fg = (g: Grid, at: [number, number]) => cell(g, at[0], at[1])[1]
const bg = (g: Grid, at: [number, number]) => cell(g, at[0], at[1])[2]

test('an agent shows a cost box, its brief and its turns from rabe.turns', () => {
  const agent = {
    ...explore,
    detail: { ...explore.detail, description: 'Find verifyToken.', lastToolAt: NOW - 3000 },
  } as RabeItem
  const m = model([agent], {
    turns: {
      [agent.id]: [
        {
          index: 1,
          at: NOW - 30_000,
          text: 'Searching.',
          tools: [{ name: 'Grep', summary: 'verifyToken' }],
        },
        {
          index: 2,
          at: NOW - 5000,
          text: 'Reading verify.ts.',
          tools: [{ name: 'Read', summary: 'verify.ts' }],
        },
      ],
    },
  })
  const { grid: g, buttons } = open(m, agent.id)
  const cost = find(g, '≈ $0.16   in 36k  out 5k')
  expect(fg(g, cost)).toBe(C.bright)
  expect(bg(g, [0, cost[1]])).toBe(C.panel)
  expect(lines(g).some(line => /^ 100% of session +active just now$/.test(line))).toBe(true)
  expect(fg(g, find(g, 'active'))).toBe(C.green)
  expect(fg(g, find(g, '▸ brief'))).toBe(C.blue)
  expect(lines(g)).toContain('  Find verifyToken.')
  const first = find(g, '1  ● Searching.')
  expect(fg(g, first)).toBe(C.dim)
  expect(fg(g, [first[0] + 3, first[1]])).toBe(C.orange)
  expect(lines(g)).toContain('     ⎿ Grep verifyToken')
  // The running turn is raised; the ones before are not.
  expect(bg(g, [0, first[1]])).not.toBe(C.raised)
  expect(bg(g, [0, find(g, '2  ● Reading verify.ts.')[1]])).toBe(C.raised)
  expect(bg(g, [0, find(g, '⎿ Read verify.ts')[1]])).toBe(C.raised)
  expect(buttons.find(b => b.key === 'stop')?.label).toBe('x: stop')
})

test('the brief of an agent is the prompt it was given when Rabe saw the spawn', () => {
  const agent = {
    ...explore,
    detail: { ...explore.detail, description: 'Find it', prompt: 'Find verifyToken in src.' },
  } as RabeItem
  const shown = lines(open(model([agent]), agent.id).grid)
  expect(shown[shown.indexOf('▸ brief') + 1]).toBe('  Find verifyToken in src.')
})

test('a long brief keeps three lines', () => {
  const agent = {
    ...explore,
    detail: { ...explore.detail, description: 'word '.repeat(60) },
  } as RabeItem
  const shown = lines(open(model([agent]), agent.id).grid)
  const at = shown.indexOf('▸ brief')
  expect(shown[at + 3]?.endsWith('…')).toBe(true)
  expect(shown[at + 4]).toBe('')
})

test('an agent without turns and tokens says n/a', () => {
  const shown = lines(open(model([verify]), verify.id).grid)
  expect(shown).toContain('Turns n/a: none seen since Rabe loaded.')
  expect(shown).toContain(' cost n/a   in 19k  out 3k')
  expect(shown.some(line => line.includes('active n/a'))).toBe(true)
})

test('a codex job shows its steps with the running command raised and an x: stop', () => {
  const job = {
    ...review,
    detail: {
      ...review.detail,
      sandbox: 'read-only',
      commandCount: 2,
      sessionUpdatedAt: NOW - 20_000,
      steps: [
        ...(review.kind === 'codex' ? (review.detail.steps ?? []) : []),
        { kind: 'command', text: 'bun test auth', exitCode: 1 },
        { kind: 'command', text: 'rg -n redact', isRunning: true },
      ],
    },
  } as RabeItem
  const { grid: g, buttons } = open(model([job]), job.id)
  const shown = lines(g)
  expect(shown).toContain('model gpt-6.1-sol · effort high · sandbox read-only')
  expect(shown).toContain('job task-1 · session file read')
  expect(shown).toContain(' ≈ $0.09   in 25k  out 3k  cached 18k')
  expect(shown.some(line => line.startsWith(' 2 commands  100% of session'))).toBe(true)
  expect(shown.some(line => line.endsWith('active 20s ago'))).toBe(true)
  expect(shown).toContain('  Review middleware/auth.ts for token-expiry bugs.')
  expect(fg(g, find(g, '● Reading the diff.'))).toBe(C.cyan)
  expect(shown).toContain('  thinking: Diff first.')
  expect(fg(g, find(g, '✓ exit 0 · 1 line'))).toBe(C.green)
  expect(fg(g, find(g, '✗ exit 1'))).toBe(C.red)
  const running = find(g, '◐ running')
  expect(fg(g, running)).toBe(C.yellow)
  expect(bg(g, [0, running[1]])).toBe(C.raised)
  expect(buttons.find(b => b.key === 'stop')).toMatchObject({
    label: 'x: stop',
    hotkey: 'x',
    action: { type: 'stop', ids: [job.id] },
  })
})

test('a codex job whose session file is gone says so', () => {
  const job = {
    ...review,
    status: 'done',
    detail: { jobId: 'task-9', isSessionMissing: true },
  } as RabeItem
  const { grid: g, buttons } = open(model([job]), job.id)
  expect(lines(g)).toContain('job task-9 · session file gone')
  expect(buttons.find(b => b.key === 'stop')).toBeUndefined()
})

test('a workflow shows its phases and each agent with tokens and time', () => {
  const { grid: g, buttons, rows } = open(model(), flow.id)
  const shown = lines(g)
  expect(shown).toContain('✓ Review → ◐ Verify → · Report')
  expect(shown).toContain(' 2 agents')
  expect(fg(g, find(g, 'VERIFY'))).toBe(C.green)
  expect(shown.some(line => /◐ verify:db\.ts +22k · 40s$/.test(line))).toBe(true)
  expect(shown.some(line => /✓ review:bugs +n\/a · 3m ago$/.test(line))).toBe(true)
  expect(Object.values(rows ?? {}).map(row => row.key)).toContain(`row:${verify.id}`)
  expect(buttons.find(b => b.key === 'stop')?.label).toBe('g: stop run')
})

test('a shell shows its output tail and its exit code in color', () => {
  const m = model(ALL, {
    lines: {
      [lint.id]: {
        seen: 87,
        lines: [
          { at: NOW, text: 'pkg/auth/verify.ts' },
          { at: NOW, text: ' 42:5 error Unexpected any' },
        ],
      },
    },
  })
  const { grid: g } = open(m, lint.id)
  const shown = lines(g)
  expect(fg(g, find(g, '▸ output · newest last · 87 lines'))).toBe(C.blue)
  expect(shown).toContain(' 42:5 error Unexpected any')
  expect(shown.findLast(line => line !== '')).toBe('✗ exit 2')
  expect(fg(g, find(g, '✗ exit 2'))).toBe(C.red)
})

test('a shell that printed one line says 1 line', () => {
  const m = model([lint], {
    lines: { [lint.id]: { seen: 1, lines: [{ at: NOW, text: 'seeding' }] } },
  })
  expect(lines(open(m, lint.id).grid)).toContain('▸ output · newest last · 1 line')
})

test('a shell without lines says its output is n/a', () => {
  expect(lines(open(model(), dev.id).grid)).toContain('Output n/a: no line read yet.')
})

test('a monitor shows each line with the time it was received', () => {
  const m = model(ALL, {
    lines: { [ci.id]: { seen: 1, lines: [{ at: NOW - 60_000, text: 'build ✓ success' }] } },
  })
  const { grid: g } = open(m, ci.id)
  expect(lines(g)).toContain('▸ lines received · newest last')
  const at = find(g, '10:51:00 build ✓ success')
  expect(fg(g, at)).toBe(C.dim)
  expect(fg(g, [at[0] + 9, at[1]])).toBe(C.text)
})

test('a cron job lists its next runs with a countdown', () => {
  const shown = lines(open(model(), babysit.id).grid)
  expect(shown).toContain('▸ next runs')
  expect(shown).toContain('  10:55  in 3:00')
  expect(shown).toContain('  11:15  in 23:00')
})

test('a wakeup shows the one time it fires', () => {
  const wake = {
    ...babysit,
    detail: { jobId: 'w', prompt: 'check', scheduledFor: NOW + 90_000 },
  } as RabeItem
  expect(lines(open(model([wake]), wake.id).grid)).toContain('  10:53  in 1:30')
})

test('a short detail keeps the head and the newest body lines', () => {
  const m = model(ALL, {
    lines: {
      [lint.id]: {
        seen: 40,
        lines: Array.from({ length: 40 }, (_, i) => ({ at: NOW, text: `line ${i}` })),
      },
    },
  })
  const { grid: g } = open(m, lint.id, { ...TERMINAL, rows: 14 })
  const shown = lines(g)
  expect(g.rows).toBe(14)
  expect(shown[0]).toMatch(/^✗ shell · bun run lint/)
  expect(shown).toContain('▸ output · newest last · 40 lines')
  expect(shown).toContain('line 39')
  expect(shown).not.toContain('line 0')
})

test('the split shows the same detail beside the list', () => {
  const { grid: g } = itemsView(
    model(),
    { ...TERMINAL, columns: 120 },
    { ...NO_SELECTION, selected: review.id },
  )
  expect(lines(g).some(line => line.endsWith('● Reading the diff.'))).toBe(true)
  expect(lines(g).some(line => line.includes('│ ▸ prompt'))).toBe(true)
})

test('a codex job without a command count says n/a', () => {
  const shown = lines(open(model([review]), review.id).grid)
  expect(shown.some(line => /^ commands n\/a {2}100% of session +active n\/a$/.test(line))).toBe(
    true,
  )
})

test('a workflow agent offers no own stop or message, only stopping its run', () => {
  const size: Size = { ...TERMINAL, hasInput: true }
  const { buttons } = open(model(), verify.id, size)
  expect(buttons.find(b => b.key === 'message-agent')).toBeUndefined()
  expect(buttons.find(b => b.key === 'stop')).toMatchObject({
    label: 'g: stop run',
    hotkey: 'g',
    action: { type: 'stop', ids: [flow.id] },
  })
})

test('a workflow agent whose run cannot be stopped offers no stop', () => {
  const run = { ...flow, detail: { runId: 'wf1', phases: [] } } as RabeItem
  const { buttons } = open(model([run, verify]), verify.id)
  expect(buttons.find(b => b.key === 'stop')).toBeUndefined()
})
