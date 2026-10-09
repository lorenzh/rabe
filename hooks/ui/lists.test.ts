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
  byParent,
  byTokens,
  costLine,
  grouped,
  groupNote,
  joinFit,
  matches,
  nameSpans,
  nextAt,
  orderOf,
  phaseProgress,
  phases,
  previousOf,
  share,
  stable,
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

test('a held order keeps rows in place: new items go to NEW at the end, status changes move nothing', () => {
  const order = orderOf(ALL)
  expect(order.failed).toEqual([lint.id])
  expect(order.agents?.at(-1)).toBe(plan.id)
  expect(order.cost?.[0]).toBe(explore.id)
  const ended = ALL.map(item =>
    item === dev ? { ...dev, status: 'failed' as const, endedAt: NOW } : item,
  )
  const fresh: RabeItem = { ...dev, id: 'shell:new', title: 'new', startedAt: NOW }
  const older: RabeItem = { ...dev, id: 'shell:old', title: 'old', startedAt: NOW - 99 * 60_000 }
  const groups = grouped([...ended, fresh, older], order)
  expect(groups.find(g => g.id === 'failed')?.items).toEqual([lint])
  expect(groups.find(g => g.id === 'shells')?.items.map(item => item.id)).toEqual([dev.id])
  expect(groups.at(-1)?.id).toBe('new')
  expect(groups.at(-1)?.items.map(item => item.id)).toEqual([fresh.id, older.id])
  expect(
    grouped(ended)
      .find(g => g.id === 'failed')
      ?.items.map(item => item.id),
  ).toEqual([dev.id, lint.id])
})

test('stable sorts a list nobody has seen and keeps a held one', () => {
  const sort = (list: RabeItem[]) => list.toSorted((a, b) => a.seenAt - b.seenAt)
  expect(stable([dev, ci, babysit], undefined, sort)).toEqual([dev, babysit, ci])
  expect(stable([dev, ci, babysit], [ci.id], sort)).toEqual([ci, dev, babysit])
})

test('byParent puts the shells of the main session first, then a block per agent', () => {
  const mine: RabeItem = { ...dev, id: 'shell:m', parentId: explore.id }
  const theirs: RabeItem = { ...ci, id: 'monitor:w', parentId: verify.id }
  const lost: RabeItem = { ...dev, id: 'shell:l', parentId: 'agent:gone' }
  const blocks = byParent([mine, dev, theirs, lost, ci], ALL)
  expect(blocks.map(block => [block.title, block.items.map(item => item.id)])).toEqual([
    ['', [dev.id, ci.id]],
    ['Explore verifyToken', [mine.id]],
    ['review-changes › verify:db.ts', [theirs.id]],
    ['agent n/a', [lost.id]],
  ])
  expect(blocks[1]?.parent).toBe(explore)
  expect(byParent([dev], ALL).map(block => block.title)).toEqual([''])
})

test('time labels say running time, age, the next run or n/a', () => {
  expect(timeLabel(explore, NOW)).toBe('1m12s')
  expect(timeLabel(dev, NOW)).toBe('≥ 40m')
  expect(timeLabel(lint, NOW)).toBe('2m ago')
  expect(timeLabel(babysit, NOW)).toBe('next 10:55')
  expect(timeLabel({ ...plan, endedAt: undefined }, NOW)).toBe('n/a')
})

// A countdown in m:ss (`next 15:44`) read like a clock time that went back on
// each drawing; the next run is its clock time, strictly after now.
test('the next run of a cron job is its clock time, the same all through a minute', () => {
  for (const s of [0, 1, 30, 59]) expect(nextAt(babysit, NOW + s * 1000)).toBe('10:55')
  expect(nextAt(babysit, NOW + 3 * 60_000 - 1)).toBe('10:55')
  expect(nextAt(babysit, NOW + 3 * 60_000)).toBe('11:00')
  const wakeup = { ...babysit, detail: { jobId: 'wakeup-1', prompt: 'go', scheduledFor: NOW } }
  expect(nextAt(wakeup as RabeItem, NOW - 60_000)).toBe('10:52')
  expect(nextAt(wakeup as RabeItem, NOW)).toBe('due')
  expect(timeLabel(wakeup as RabeItem, NOW + 5_000)).toBe('due')
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
  expect(text(rows[6]?.names)).toEqual(['/babysit-prs · next 10:55'])
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
  expect(costLine(unpriced, 0.41)).toBe('≈ $0.41 · 91k tok · top: Explore verifyToken 41k')
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
    { name: '.claude/worktrees/pkg-db', branch: 'worktree-agent-a1', items: [explore] },
  ])
})

test('previousOf sums a session up: counts per kind, tokens, cost, failed titles', () => {
  const summary = previousOf(ALL, NOW, { startedAt: NOW - 3_600_000, usd: 0.32 })
  expect(summary).toEqual({
    endedAt: NOW,
    startedAt: NOW - 3_600_000,
    counts: { agent: 4, codex: 1, shell: 2, monitor: 1, cron: 1, workflow: 1 },
    tokens: 91_000,
    usd: 0.32,
    failed: ['bun run lint'],
  })
})

test('items Rabe saw after the open hold their order in NEW, under every held row', () => {
  const order = orderOf([explore])
  const older: RabeItem = { ...dev, id: 'shell:a', startedAt: NOW - 9 * 60_000 }
  const newer: RabeItem = { ...dev, id: 'shell:b', startedAt: NOW - 60_000 }
  const watch: RabeItem = { ...ci, id: 'monitor:b', startedAt: NOW - 60_000 }
  const fails: RabeItem = { ...review, id: 'codex:x', status: 'failed', endedAt: NOW }
  const ids = (items: RabeItem[]) => grouped(items, order).map(g => [g.id, g.items.map(i => i.id)])
  const running = [explore, older, newer, ci, watch, fails]
  const ids0 = [older.id, newer.id, ci.id, watch.id, fails.id]
  expect(ids(running)).toEqual([
    ['agents', [explore.id]],
    ['new', ids0],
  ])
  const ended = running.map(item =>
    item === newer || item === watch ? { ...item, status: 'done' as const, endedAt: NOW } : item,
  )
  expect(ids(ended)).toEqual(ids(running))
  expect(grouped(running).some(g => g.id === 'new')).toBe(false)
  expect(orderOf(running).new).toBeUndefined()
})
