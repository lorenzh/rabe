import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { MAX_ENDED } from '../registry'
import { memoryState } from '../testing'

const lines = { seen: 1, lines: [{ at: 1, text: 'ready' }] }
const turns = [{ index: 1, at: 1, text: 'done', tools: [] }]

// The oldest ended item is the agent, then shell s1; the cap holds exactly MAX_ENDED.
function full(): RabeItem[] {
  const ended: RabeItem[] = Array.from({ length: MAX_ENDED }, (_, n) =>
    n === 0
      ? {
          id: 'agent:a0',
          kind: 'agent',
          title: 'a0',
          status: 'done',
          seenAt: 1,
          endedAt: 1,
          detail: { agentId: 'a0' },
        }
      : {
          id: `shell:s${n}`,
          kind: 'shell',
          title: `s${n}`,
          status: 'done',
          seenAt: 1,
          endedAt: n + 1,
          detail: { command: `s${n}` },
        },
  )
  const cron = (id: string): RabeItem => ({
    id: `cron:${id}`,
    kind: 'cron',
    title: id,
    status: 'running',
    seenAt: 1,
    detail: { jobId: id, prompt: id, schedule: '* * * * *' },
  })

  return [...ended, cron('c1'), cron('c2')]
}

function cronDelete(on: On) {
  on('tool.call', { tool: 'CronDelete' }, async (_$, e) => ({
    result: { id: e.tool === 'CronDelete' ? e.id : '' },
  }))
}

test('an item the cap drops loses its lines and turns, though its output never changed', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: full(), version: 1 }
  state['rabe.lines'] = { value: { 'shell:s1': lines, 'shell:s5': lines }, version: 1 }
  state['rabe.turns'] = { value: { 'agent:a0': turns }, version: 1 }
  cronDelete(on)

  // A cron job ending pushes the oldest ended item, an agent, out of the list.
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  expect(state['rabe.turns']?.value).toEqual({})
  expect(state['rabe.lines']?.value).toEqual({ 'shell:s1': lines, 'shell:s5': lines })

  // The next one pushes out shell s1: its lines go, those of s5 stay.
  await $.tool.call({ tool: 'CronDelete', id: 'c2' })
  expect(state['rabe.lines']?.value).toEqual({ 'shell:s5': lines })
  expect(state['rabe.evicted']?.value).toEqual(['agent:a0', 'shell:s1'])
})

test('a write that drops nothing leaves lines, turns and the evicted list alone', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: full().slice(1), version: 1 }
  state['rabe.lines'] = { value: { 'shell:s1': lines }, version: 1 }
  state['rabe.turns'] = { value: {}, version: 1 }
  cronDelete(on)
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  expect(state['rabe.lines']).toEqual({ value: { 'shell:s1': lines }, version: 1 })
  expect(state['rabe.turns']).toEqual({ value: {}, version: 1 })
  expect(state['rabe.evicted']).toBeUndefined()
})
