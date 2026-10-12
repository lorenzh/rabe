import { expect, test } from 'claude-code/testing'
import { codexItem, parseRollout } from './codex-data'

test('codex data skips invalid records and preserves cost when the rollout is unchanged', () => {
  expect(parseRollout('invalid\nnull\n[]').requests).toEqual([])
  const item = codexItem(
    { id: 'job', summary: 'title\nprivate', request: { model: 'model' } },
    { path: '/rollout', updatedAt: 1 },
  )
  expect(item.title).toBe('title')
  expect('costUsd' in item).toBe(false)
  expect('model' in item.detail).toBe(false)
})
