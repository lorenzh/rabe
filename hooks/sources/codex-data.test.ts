import { expect, test } from 'claude-code/testing'
import { advanceRollout, codexItem, parseRollout, rolloutCursor } from './codex-data'

test('rollout cursors reject wrong-type steps, edits and tokens', () => {
  const held = advanceRollout('')
  for (const out of [
    ...['message', 'reasoning', 'command'].map(kind => ({ steps: [{ kind, text: 42 }] })),
    { steps: [{ kind: 'unknown', text: 'text' }] },
    ...['exitCode', 'lines', 'isRunning'].map(key => ({
      steps: [{ kind: 'command', text: 'cmd', [key]: 'bad' }],
    })),
    { edits: [{ path: 42, at: 1 }] },
    { edits: [{ path: '/file', at: 'bad' }] },
    { edits: [{ path: '/file', at: 1, via: 42 }] },
    { edits: [{ path: '/file', at: 1, change: 42 }] },
    { tokens: { input: 'bad', output: 1 } },
    { tokens: { input: 1, output: 'bad' } },
    { tokens: { input: 1, output: 1, cached: 'bad' } },
  ]) {
    expect(rolloutCursor({ ...held, out: { ...held.out, ...out } })).toBeUndefined()
  }
  const valid = {
    ...held,
    out: {
      ...held.out,
      steps: [
        { kind: 'message', text: 'reply' },
        { kind: 'reasoning', text: 'thought' },
        { kind: 'command', text: 'cmd', exitCode: 0, lines: 1, isRunning: false },
      ],
      edits: [{ path: '/file', at: 1, via: 'codex', change: 'update' }],
      tokens: { input: 1, output: 1, cached: 0 },
    },
  }
  expect(rolloutCursor(valid)).toBe(valid)
})

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
