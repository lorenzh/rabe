import { expect, test } from 'claude-code/testing'

import type { NewItem } from './model'
import { addItem, capEnded, commit, endItem, MAX_ENDED, updateItem } from './registry'

const shell: NewItem = {
  id: 'shell:bg_1',
  kind: 'shell',
  title: 'bun test --watch',
  status: 'running',
  startedAt: 100,
  detail: { command: 'bun test --watch', taskId: 'bg_1' },
}

test('add appends a new item with the time Rabe saw it', () => {
  expect(addItem([], shell, 500)).toEqual([{ ...shell, seenAt: 500 }])
})

test('add merges into an existing item and keeps seenAt', () => {
  const items = addItem([{ ...shell, seenAt: 500 }], { ...shell, title: 'tests' }, 900)
  expect(items).toEqual([{ ...shell, title: 'tests', seenAt: 500 }])
})

test('add returns the same list when nothing changed', () => {
  const items = [{ ...shell, seenAt: 500 }]
  expect(addItem(items, shell, 900)).toBe(items)
})

test('update merges fields and detail', () => {
  const items = updateItem([{ ...shell, seenAt: 500 }], shell.id, {
    tokens: { input: 1, output: 2 },
    detail: { exitCode: 2 },
  })
  expect(items[0]).toEqual({
    ...shell,
    seenAt: 500,
    tokens: { input: 1, output: 2 },
    detail: { command: 'bun test --watch', taskId: 'bg_1', exitCode: 2 },
  })
})

test('update returns the same list for an unknown id or no change', () => {
  const items = [{ ...shell, seenAt: 500 }]
  expect(updateItem(items, 'shell:nope', { title: 'x' })).toBe(items)
  expect(updateItem(items, shell.id, { title: shell.title })).toBe(items)
})

test('end sets status and end time once', () => {
  const ended = endItem([{ ...shell, seenAt: 500 }], shell.id, 'failed', 800)
  expect(ended[0]?.status).toBe('failed')
  expect(ended[0]?.endedAt).toBe(800)
  expect(endItem(ended, shell.id, 'done', 900)).toBe(ended)
})

test('cap drops the oldest ended items and keeps every running one', () => {
  const items = [1, 2, 3, 4].map(n => ({
    ...shell,
    id: `shell:${n}`,
    seenAt: n,
    ...(n === 2 ? {} : { status: 'done' as const, endedAt: n }),
  }))
  expect(capEnded(items, 1).map(item => item.id)).toEqual(['shell:2', 'shell:4'])
  expect(capEnded(items, 3)).toBe(items)
})

test('commit answers undefined when nothing changed, else the capped list', () => {
  const items = [{ ...shell, seenAt: 500 }]
  expect(commit(items, held => updateItem(held, shell.id, { title: shell.title }))).toBeUndefined()
  expect(commit(undefined, held => addItem(held, shell, 500))).toEqual(items)
  const many = Array.from({ length: MAX_ENDED + 1 }, (_, n) => ({
    ...shell,
    id: `shell:${n}`,
    seenAt: n,
    status: 'done' as const,
  }))
  expect(commit(many, held => held.slice())).toHaveLength(MAX_ENDED)
})
