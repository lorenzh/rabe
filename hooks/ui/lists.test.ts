import { expect, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import type { Span } from './cells/grid'
import { C } from './cells/palette'

import {
  ALL,
  babysit,
  ci,
  dev,
  explore,
  flow,
  lint,
  NOW,
  plan,
  review,
  reviewed,
  verify,
} from './fixtures'
import {
  bandRows,
  bar,
  byTokens,
  costLine,
  grouped,
  groupNote,
  joinFit,
  matches,
  nameSpans,
  phaseProgress,
  phases,
  share,
  timeLabel,
  totals,
  tree,
  worktrees,
} from './lists'

test('groups put failed first and running before ended', () => {
  const groups = grouped(ALL)
  expect(groups.map(g => g.id)).toEqual(['failed', 'agents', 'shells', 'monitors', 'cron'])
  expect(groups[0]?.items).toEqual([lint])
  expect(groups[1]?.items.at(-1)).toBe(plan)
  expect(groupNote('agents', groups[1]?.items ?? [])).toBe('4 claude · 1 codex · 1 workflow')
  expect(groupNote('shells', [dev, { ...dev, status: 'done' }])).toBe('1 running · 1 ended')
})

test('time labels say running time, age, countdown or n/a', () => {
  expect(timeLabel(explore, NOW)).toBe('1m12s')
  expect(timeLabel(dev, NOW)).toBe('≥ 40m')
  expect(timeLabel(lint, NOW)).toBe('2m ago')
  expect(timeLabel(babysit, NOW)).toBe('next 3:00')
  expect(timeLabel({ ...plan, endedAt: undefined }, NOW)).toBe('n/a')
})

test('names add the port and the exit code of shells', () => {
  expect(nameSpans(dev)).toEqual([
    ['bun run dev', {}],
    [' :5173', { fg: C.blue }],
  ])
  expect(nameSpans(lint)).toEqual([
    ['bun run lint', {}],
    [' exit 2', { fg: C.red }],
  ])
})

test('search matches title, kind and command', () => {
  expect(matches(dev, 'DEV')).toBe(true)
  expect(matches(review, 'codex')).toBe(true)
  expect(matches(ci, 'gh run')).toBe(true)
  expect(matches(ci, 'nope')).toBe(false)
})

test('the band has one row per kind with running names, failed first', () => {
  const rows = bandRows(ALL, NOW)
  expect(rows.map(row => row.label)).toEqual([
    'failed',
    'claude',
    'codex',
    'workflow',
    'shells',
    'watch',
    'cron',
  ])
  const text = (names: Span[][] = []) => names.map(one => one.map(([t]) => t).join(''))
  expect(text(rows[1]?.names)).toEqual(['Explore verifyToken 1m', 'verify:db.ts 40s'])
  expect(text(rows[3]?.names)).toEqual(['review-changes · Verify 2/3 · 2 agents'])
  expect(text(rows[6]?.names)).toEqual(['/babysit-prs · next 3:00'])
  expect(bandRows([{ ...lint, endedAt: NOW - 11 * 60_000 }], NOW)).toEqual([])
})

test('joinFit stops at the width and counts the rest', () => {
  const names: Span[][] = [[['aaa']], [['bbb']], [['ccc']]]
  const text = (list: Span[]) => list.map(([t]) => t).join('')
  expect(text(joinFit(names, 20))).toBe('aaa · bbb · ccc')
  expect(joinFit(names, 10)).toEqual([['aaa'], [' +2', { fg: C.dim }]])
})

test('cost totals sum tokens and dollars and count unknowns', () => {
  expect(totals(ALL)).toEqual({ usd: 0.25, tokens: 91_000, unknown: 2, claude: 0.16, codex: 0.09 })
  expect(byTokens(ALL).slice(0, 3)).toEqual([explore, review, verify])
  expect(share(ALL, explore)).toBe('45%')
  expect(share(ALL, plan)).toBe('n/a')
})

test('without any dollar amount the cost is n/a, not $0.00', () => {
  const unpriced = ALL.map(({ costUsd: _, ...item }) => item as RabeItem)
  expect(totals(unpriced)).toEqual({ tokens: 91_000, unknown: 2 })
  expect(costLine(unpriced)).toBe('cost n/a · 91k tok · top: Explore verifyToken 41k')
})

test('workflow phases follow the agents in them', () => {
  expect(phases(ALL, flow).map(p => [p.name, p.state, p.agents.length])).toEqual([
    ['Review', 'done', 1],
    ['Verify', 'running', 1],
    ['Report', 'waiting', 0],
  ])
  expect(phaseProgress(ALL, flow)).toBe('Verify 2/3')
})

test('the tree nests items under their parent', () => {
  expect(
    tree([flow, verify, reviewed, dev]).map(line => `${line.prefix}${line.item.title}`),
  ).toEqual(['├─ review-changes', '│  ├─ verify:db.ts', '│  └─ review:bugs', '└─ bun run dev'])
})

test('a bar marks the part of the window an item ran', () => {
  expect(bar(0, 50, 0, 100, 10)).toBe('█████     ')
  expect(bar(99, 100, 0, 100, 4)).toBe('   █')
})

test('worktrees list each folder with its agents', () => {
  expect(worktrees(ALL)).toEqual([
    { name: 'pkg-db', branch: 'worktree-agent-a1', items: [explore] },
  ])
})
