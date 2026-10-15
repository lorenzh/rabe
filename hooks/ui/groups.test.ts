import { expect, test } from 'claude-code/testing'

import type { RabeMainUsage } from '../../types'
import type { RabeItem } from '../model'
import { explore, plan, review, verify } from './fixtures'
import { groupRows, heldRows, mainTotal, orderIds } from './groups'

const MAIN: Record<string, RabeMainUsage> = {
  'claude-opus-5-5': { steps: 2, input: 1000, output: 200, cached: 500, usd: 0.5 },
  'claude-new-9': { steps: 1, input: 100, output: 10, cached: 0, isUnpriced: true },
}

test('the model grouping sums workers per model and keeps n/a for what has no price', () => {
  const rows = groupRows('model', [explore, review, verify, plan])
  expect(rows.map(row => [row.title, row.tokens, row.costUsd, row.count])).toEqual(
    [
      ['opus-5-5', 41_000, 0.16, 1],
      ['gpt-6.1-sol', 28_000, 0.09, 1],
      // verify has no model; plan has no tokens, so the row sums verify and is n/a
      ['model n/a', 22_000, undefined, 2],
    ].toSorted((a, b) => Number(b[1]) - Number(a[1])),
  )
})

test('the harness grouping counts a forwarder once, in its Codex job', () => {
  const forwarder: RabeItem = {
    ...explore,
    id: 'agent:f1',
    tokens: { input: 1000, output: 100 },
    costUsd: 0.01,
    detail: { agentId: 'f1', toolCount: 1, codexCalls: [{ at: 1, command: 'task', text: 't' }] },
  } as RabeItem
  const job = { ...review, parentId: forwarder.id } as RabeItem
  const rows = groupRows('harness', [forwarder, job])
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ title: 'Codex', tokens: 29_100, count: 1 })
  expect(Math.round((rows[0]?.costUsd ?? 0) * 1e6)).toBe(100_000)
})

test('main steps have their own partial rows and never join a worker row', () => {
  const model = groupRows('model', [explore], MAIN)
  expect(model.map(row => [row.id, row.tokens, row.costUsd])).toEqual([
    ['by:model:opus-5-5', 41_000, 0.16],
    ['by:model:main:claude-opus-5-5', 1200, 0.5],
    ['by:model:main:claude-new-9', 110, undefined],
  ])
  expect(model[1]?.title).toContain('partial')
  const harness = groupRows('harness', [explore, review], MAIN)
  expect(harness.find(row => row.id === 'by:harness:main')).toMatchObject({
    tokens: 1310,
    costUsd: undefined,
  })
  expect(mainTotal('agent', {})).toBeUndefined()
})

test('a held order keeps the rows in place, new rows after it', () => {
  const rows = groupRows('model', [explore, review])
  const held = orderIds('model', [explore, review])
  const grown = groupRows('model', [{ ...review, tokens: { input: 900_000, output: 0 } }, explore])
  expect(heldRows(grown, held).map(row => row.id)).toEqual(held)
  expect(heldRows(grown).map(row => row.id)).toEqual([rows[1]?.id, rows[0]?.id])
})
