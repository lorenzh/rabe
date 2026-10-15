import { expect, test } from 'claude-code/testing'
import {
  advanceRollout,
  codexItem,
  execMeta,
  matchExec,
  parseRollout,
  rolloutCursor,
  sessionIdOf,
} from './codex-data'

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

const meta = (payload: object) =>
  JSON.stringify({ type: 'session_meta', timestamp: '1970-01-01T00:00:10.000Z', payload })
const ID = '01a14163-d731-71c3-825e-494f278f73c7'

test('the session id line of codex exec output names its thread; two different ids name none', () => {
  const header = `OpenAI Codex v0.162.1\n--------\nmodel: gpt-6.1-sol\nsession id: ${ID}\n--------`
  expect(sessionIdOf(header)).toBe(ID)
  expect(sessionIdOf(`${header}\nsession id: ${ID}`)).toBe(ID)
  expect(sessionIdOf(`${header}\nsession id: 01a14163-0000-71c3-825e-494f278f73c7`)).toBeUndefined()
  expect(sessionIdOf('session id: ../../x')).toBeUndefined()
  expect(sessionIdOf('ok')).toBeUndefined()
})

test('only the first record of a direct exec rollout gives its start, id and directory', () => {
  const at = Date.parse('1970-01-01T00:00:09.500Z')
  const exec = meta({ id: ID, timestamp: '1970-01-01T00:00:09.500Z', cwd: '/w', source: 'exec' })
  expect(execMeta(exec, '/s/r.jsonl')).toEqual({ path: '/s/r.jsonl', id: ID, at, cwd: '/w' })
  // a Codex subagent's or another client's session is no direct run
  const sub = { id: ID, timestamp: '1970-01-01T00:00:09.500Z', source: { subagent: 'x' } }
  expect(execMeta(meta(sub), '/s/r.jsonl')).toBeUndefined()
  expect(execMeta(meta({ id: ID, source: 'vscode' }), '/s/r.jsonl')).toBeUndefined()
  expect(execMeta('{"type":"event_msg","payload":{}}', '/s/r.jsonl')).toBeUndefined()
  expect(execMeta('{"type":"session_meta","payl', '/s/r.jsonl')).toBeUndefined()
  // no start time: it cannot be matched
  expect(execMeta(meta({ id: ID, source: 'exec', timestamp: 'x' }), '/s/r.jsonl')).toMatchObject({
    at: 10_000,
  })
  expect(
    execMeta(JSON.stringify({ type: 'session_meta', payload: { id: ID, source: 'exec' } }), '/r'),
  ).toBeUndefined()
})

test('a run matches the one rollout that started near it, in its -C directory', () => {
  const file = (path: string, at: number, cwd = '/w') => ({ path, id: path, at, cwd })
  const a = { id: 'shell:fg-a', startedAt: 100_000 }
  // started 1 s later: the run's file
  expect(matchExec([a], [file('/r1', 101_000)])).toEqual(
    new Map([['shell:fg-a', file('/r1', 101_000)]]),
  )
  // too early, too late: none
  expect(matchExec([a], [file('/r1', 90_000), file('/r2', 120_000)]).size).toBe(0)
  // two files near it: ambiguous, none
  expect(matchExec([a], [file('/r1', 101_000), file('/r2', 102_000)]).size).toBe(0)
  // -C names the directory: only the file there counts
  const c = { ...a, dir: '/w' }
  expect(
    matchExec([c], [file('/r1', 101_000), file('/r2', 102_000, '/other')]).get(c.id)?.path,
  ).toBe('/r1')
})

test('a file two runs could own matches neither', () => {
  const a = { id: 'shell:fg-a', startedAt: 100_000 }
  const b = { id: 'shell:fg-b', startedAt: 103_000 }
  const one = { path: '/r1', id: 'r1', at: 104_000, cwd: '/w' }
  expect(matchExec([a, b], [one]).size).toBe(0)
  // with -C the directories tell them apart
  const far = { path: '/r2', id: 'r2', at: 101_000, cwd: '/v' }
  const matched = matchExec(
    [
      { ...a, dir: '/v' },
      { ...b, dir: '/w' },
    ],
    [one, far],
  )
  expect([...matched].map(([id, file]) => [id, file.path])).toEqual([
    ['shell:fg-a', '/r2'],
    ['shell:fg-b', '/r1'],
  ])
})

test('a rollout records when its task completed, and a new task opens it again', () => {
  const event = (type: string, at: string) =>
    JSON.stringify({ type: 'event_msg', timestamp: at, payload: { type } })
  const done = [
    event('task_started', '1970-01-01T00:00:01.000Z'),
    event('task_complete', '1970-01-01T00:00:05.000Z'),
  ]
  expect(parseRollout(done.join('\n')).endedAt).toBe(5000)
  const again = [...done, event('task_started', '1970-01-01T00:00:06.000Z')]
  expect(parseRollout(again.join('\n')).endedAt).toBeUndefined()
  const held = advanceRollout(done.join('\n'))
  expect(rolloutCursor(held)).toBe(held)
  expect(rolloutCursor({ ...held, out: { ...held.out, endedAt: 'x' } })).toBeUndefined()
})
