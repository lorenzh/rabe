import { expect, test } from 'claude-code/testing'

import type { RabeTurn } from '../../../types'
import type { RabeItem } from '../../model'
import { cell, lines } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { ALL, dev, explore, NOW, plan } from '../fixtures'
import { type Model, NO_SELECTION, type Size } from '../view'
import { effectsView } from './effects'

const SIZE: Size = { columns: 90, rows: 30, surface: 'terminal', hasInput: false }

const api: RabeItem = {
  id: 'agent:a3',
  kind: 'agent',
  title: 'logger in api',
  status: 'running',
  seenAt: NOW - 60_000,
  startedAt: NOW - 60_000,
  detail: { agentId: 'a3', cwd: '/repo' },
}

// Edits the engine ran, kept on each agent; a turn's tool calls are only asked for.
const editing = (agent: RabeItem, ...edits: [at: number, ...paths: string[]][]): RabeItem =>
  ({
    ...agent,
    detail: {
      ...agent.detail,
      edits: edits.flatMap(([at, ...paths]) => paths.map(path => ({ path, at }))),
    },
  }) as RabeItem

const ITEMS = [
  ...ALL.map(item =>
    item.id === plan.id
      ? editing(plan, [NOW - 8 * 60_000, '/repo/src/logger.ts', '/repo/src/cli/main.ts'])
      : item.id === explore.id
        ? editing(explore, [NOW - 60_000, '/repo/.claude/worktrees/pkg-db/src/db/pool.ts'])
        : item,
  ),
  editing(
    api,
    [NOW - 30_000, '/repo/src/logger.ts'],
    [NOW - 10_000, '/repo/src/logger.ts', '/repo/src/api/server.ts'],
  ),
]

// Asked for, never run: the Effects tab leaves these out.
const TURNS: Record<string, RabeTurn[]> = {
  [api.id]: [
    {
      index: 1,
      at: NOW - 20_000,
      text: '',
      tools: [
        { name: 'Read', summary: '/repo/x.ts' },
        { name: 'Edit', summary: '/repo/denied.ts' },
      ],
    },
  ],
}

const MODEL: Model = { items: ITEMS, turns: TURNS, lines: {}, now: NOW }

test('a file edited by two agents in one tree heads the tab as a conflict', () => {
  const { grid } = effectsView(MODEL, SIZE, NO_SELECTION)
  const shown = lines(grid)
  expect(shown[0]).toBe(
    ' ⚠ conflict  src/logger.ts is edited by Plan auth split and logger in api in the main tree',
  )
  expect(cell(grid, 1, 0)).toEqual(['⚠'.codePointAt(0), C.red, CHIP.failed.bg])
  expect(cell(grid, 89, 0)[2]).toBe(CHIP.failed.bg)
})

test('files touched list each file with who edited it and how often, conflicts first', () => {
  const { grid } = effectsView(MODEL, SIZE, NO_SELECTION)
  const shown = lines(grid)
  const head = shown.indexOf('FILES TOUCHED 4  from agent tool calls')
  expect(head).toBeGreaterThan(0)
  expect(shown[head + 1]).toMatch(/^ {2}FILE +BY +CHANGE$/)
  expect(shown[head + 2]).toMatch(/^ {2}src\/logger\.ts +Plan auth split, logger in api +3 edits$/)
  expect(cell(grid, 2, head + 2)[1]).toBe(C.yellow)
  expect(shown[head + 3]).toMatch(/^ {2}src\/api\/server\.ts +logger in api +1 edit$/)
  expect(
    shown.some(line => /^ {2}src\/db\/pool\.ts +Explore verifyToken +1 edit$/.test(line)),
  ).toBe(true)
  expect(shown.some(line => line.includes('x.ts') || line.includes('denied.ts'))).toBe(false)
})

test('worktrees show the path, branch and agents, then the main tree', () => {
  const shown = lines(effectsView(MODEL, SIZE, NO_SELECTION).grid)
  const head = shown.indexOf('WORKTREES 1  from agent metadata, running agents included')
  expect(head).toBeGreaterThan(0)
  expect(shown[head + 1]).toMatch(
    /^ {2}⎇ \.claude\/worktrees\/pkg-db +worktree-agent-a1 · Explore verifyToken$/,
  )
  expect(shown[head + 2]).toMatch(/^ {2}⎇ main tree +Plan auth split, logger in api$/)
})

test('ports show the command and the ssh line; c copies the first', () => {
  const drawn = effectsView(MODEL, SIZE, NO_SELECTION)
  const shown = lines(drawn.grid)
  const head = shown.indexOf('PORTS 1  found in shell output, may miss some')
  expect(shown[head + 1]).toBe('  :5173  bun run dev')
  expect(shown[head + 2]).toMatch(/^ {6}ssh -L 5173:localhost:5173 <your-host> +c copies$/)
  expect(cell(drawn.grid, 0, head + 2)[2]).toBe(CHIP.monitor.bg)
  expect(drawn.buttons).toEqual([
    {
      key: 'port-5173',
      label: 'c: copy ssh :5173',
      hotkey: 'c',
      action: { type: 'copy', text: 'ssh -L 5173:localhost:5173 <your-host>' },
    },
  ])
})

test('with no edits, agents or ports each section says so', () => {
  const drawn = effectsView({ items: [], turns: {}, lines: {}, now: NOW }, SIZE, NO_SELECTION)
  const shown = lines(drawn.grid)
  expect(shown[0]).toBe('FILES TOUCHED 0  from agent tool calls')
  expect(shown).toContain('  No agent edited a file yet.')
  expect(shown).toContain('  No agents yet.')
  expect(shown).toContain('  No open port found.')
  expect(drawn.buttons).toEqual([])
})

test('a long file list is cut to the rows left, with the rest counted', () => {
  const many = Array.from({ length: 40 }, (_, i) => `/repo/f${i}.ts`)
  const model = { ...MODEL, items: [editing(api, [NOW, ...many]), dev], turns: {} }
  const { grid } = effectsView(model, { ...SIZE, rows: 16 }, NO_SELECTION)
  const shown = lines(grid)
  expect(grid.rows).toBeLessThanOrEqual(16)
  expect(shown.some(line => /^ {2}… \d+ more$/.test(line))).toBe(true)
  expect(shown).toContain('  :5173  bun run dev')
})
