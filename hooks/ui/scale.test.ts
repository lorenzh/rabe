import { expect, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { addItem, commit } from '../registry'
import { NOW } from './fixtures'
import { orderOf } from './lists'
import { type Model, NO_SELECTION, type Size } from './view'
import { bandView } from './views/band'
import { costView } from './views/cost'
import { itemsView } from './views/items'
import { timelineView } from './views/timeline'

const SIZE: Size = { columns: 100, rows: 40, surface: 'terminal', hasInput: false }

// Per group of items: a Claude agent that only forwarded to Codex, its job,
// two shells and a workflow run, a monitor and a cron job the agent started.
// All run, so the cap on ended items leaves them in the list.
function session(groups: number): RabeItem[] {
  return Array.from({ length: groups }, (_, n): RabeItem[] => {
    const base = { seenAt: NOW - n * 1000, startedAt: NOW - n * 1000, status: 'running' } as const
    const agent = `agent:a${n}`
    const call = { at: 1, command: 'task', text: 'x' } as const

    return [
      {
        ...base,
        id: agent,
        kind: 'agent',
        title: `agent ${n}`,
        tokens: { input: n, output: 5 },
        costUsd: 0.1,
        detail: { agentId: `a${n}`, toolCount: 1, codexCalls: [call] },
      },
      {
        ...base,
        id: `codex:j${n}`,
        kind: 'codex',
        title: `job ${n}`,
        parentId: agent,
        tokens: { input: n, output: 5 },
        costUsd: 0.1,
        detail: { jobId: `j${n}` },
      },
      ...[0, 1].map(
        (k): RabeItem => ({
          ...base,
          id: `shell:s${n}-${k}`,
          kind: 'shell',
          title: `shell ${n}`,
          parentId: agent,
          detail: { command: 'x', taskId: `s${n}-${k}` },
        }),
      ),
      {
        ...base,
        id: `workflow:w${n}`,
        kind: 'workflow',
        title: `run ${n}`,
        detail: { runId: `w${n}` },
      },
      {
        ...base,
        id: `monitor:m${n}`,
        kind: 'monitor',
        title: `watch ${n}`,
        detail: { command: 'x', taskId: `m${n}` },
      },
      {
        ...base,
        id: `cron:c${n}`,
        kind: 'cron',
        title: `cron ${n}`,
        detail: { jobId: `c${n}`, prompt: 'p', schedule: '*/5 * * * *' },
      },
    ]
  }).flat()
}

// Items that count each property a function reads: the work it does on them.
function watched(items: RabeItem[]): { list: RabeItem[]; reads: () => number } {
  let reads = 0
  const list = items.map(
    item =>
      new Proxy(item, {
        get(target, key) {
          reads++
          return Reflect.get(target, key)
        },
      }),
  )

  return { list, reads: () => reads }
}

// Reads of `work` on a list `groups` times as large as the base one.
function reads(groups: number, work: (items: RabeItem[]) => unknown): number {
  const { list, reads } = watched(session(groups))
  work(list)

  return reads()
}

const draw = (items: RabeItem[]): Model => ({ items, turns: {}, lines: {}, now: NOW })

const WORK: [string, (items: RabeItem[]) => unknown][] = [
  ['the order the pane opens with', items => orderOf(items)],
  ['the band', items => bandView(draw(items), SIZE, NO_SELECTION)],
  [
    'the Items list',
    items => itemsView(draw(items), SIZE, { ...NO_SELECTION, order: orderOf(items) }),
  ],
  [
    'the Timeline',
    items => timelineView(draw(items), SIZE, { ...NO_SELECTION, order: orderOf(items) }),
  ],
  [
    'the Cost tab',
    items => costView(draw(items), SIZE, { ...NO_SELECTION, order: orderOf(items) }),
  ],
  [
    'one commit',
    items =>
      commit(items, held =>
        addItem(
          held,
          { ...(held[0] as RabeItem), id: 'agent:new', seenAt: undefined } as never,
          NOW,
        ),
      ),
  ],
]

// A pass over the list reads a constant number of properties per item, so
// four times the items read about four times as much. A scan of the list per
// item reads sixteen times as much. Counting reads keeps the test free of clocks.
for (const [name, work] of WORK) {
  test(`${name} does work linear in the item count`, () => {
    const ratio = reads(200, work) / reads(50, work)
    expect(ratio).toBeLessThan(6)
  })
}
