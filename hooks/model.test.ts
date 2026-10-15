import { expect, test } from 'claude-code/testing'

import { itemId, KINDS, mergeItem, parentOf, type RabeItem, runOf } from './model'

test('an item id joins kind and native id', () => {
  expect(itemId('codex', 'task-1')).toBe('codex:task-1')
})

test('merge overwrites fields and merges detail', () => {
  const shell: RabeItem = {
    id: 'shell:bg_1',
    kind: 'shell',
    title: 'bun run lint',
    status: 'running',
    seenAt: 1,
    detail: { command: 'bun run lint', taskId: 'bg_1' },
  }
  expect(mergeItem(shell, { status: 'failed', detail: { exitCode: 2 } })).toEqual({
    ...shell,
    status: 'failed',
    detail: { command: 'bun run lint', taskId: 'bg_1', exitCode: 2 },
  })
})

test('parentOf and runOf find the item that started one, runOf only a workflow', () => {
  const flow: RabeItem = {
    id: 'workflow:w',
    kind: 'workflow',
    title: 'w',
    status: 'running',
    seenAt: 1,
    detail: { runId: 'w' },
  }
  const lead: RabeItem = {
    id: 'agent:a',
    kind: 'agent',
    title: 'a',
    status: 'running',
    seenAt: 1,
    detail: { agentId: 'a' },
  }
  const kid: RabeItem = { ...lead, id: 'agent:b', parentId: 'workflow:w' }
  const grandkid: RabeItem = { ...lead, id: 'agent:c', parentId: 'agent:a' }
  const items = [flow, lead, kid, grandkid]
  expect(parentOf(kid, items)).toBe(flow)
  expect(runOf(kid, items)).toBe(flow)
  expect(parentOf(grandkid, items)).toBe(lead)
  expect(runOf(grandkid, items)).toBeUndefined()
  expect(parentOf(lead, items)).toBeUndefined()
  expect(runOf({ parentId: 'agent:gone' }, items)).toBeUndefined()
})

test('KINDS lists every item kind once', () => {
  expect([...KINDS].toSorted()).toEqual(['agent', 'codex', 'cron', 'monitor', 'shell', 'workflow'])
})
