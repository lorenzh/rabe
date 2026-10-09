import type { On } from 'claude-code'
import { type Engine, expect, type MockClock, mock, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { memoryState } from '../testing'
import { codexItem, jobEnd, parseRollout } from './codex'

const line = (type: string, payload: object) => JSON.stringify({ type, payload })

const ROLLOUT = [
  line('session_meta', { id: 'th-1' }),
  line('turn_context', {
    model: 'gpt-6.1-sol',
    effort: 'high',
    sandbox_policy: { type: 'read-only' },
  }),
  line('event_msg', {
    type: 'item_completed',
    item: { type: 'UserMessage', content: [{ type: 'text', text: 'Review pkg/auth.' }] },
  }),
  line('response_item', {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'I will read the diff first.' }],
  }),
  line('response_item', {
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: '**Checking verify.ts**' }],
  }),
  line('response_item', { type: 'reasoning', summary: [], encrypted_content: 'x' }),
  line('response_item', {
    type: 'custom_tool_call',
    call_id: 'c1',
    input: 'text(await tools.exec_command({cmd:"git diff main"}))',
  }),
  line('event_msg', {
    type: 'item_completed',
    item: {
      type: 'CommandExecution',
      command: ['/bin/bash', '-lc', 'git diff main'],
      exit_code: 0,
      aggregated_output: 'a\nb\nc\n',
    },
  }),
  line('response_item', { type: 'custom_tool_call_output', call_id: 'c1' }),
  line('event_msg', {
    type: 'token_count',
    info: {
      total_token_usage: { input_tokens: 25000, cached_input_tokens: 18000, output_tokens: 3000 },
    },
  }),
  line('response_item', {
    type: 'custom_tool_call',
    call_id: 'c2',
    input: 'text(await tools.exec_command({cmd:"rg -n \\"redact\\" pkg"}))',
  }),
  '{"type":"event_msg","payload":{"type":"token_cou',
].join('\n')

test('a rollout gives model, effort, sandbox, prompt, tokens and steps', () => {
  expect(parseRollout(ROLLOUT)).toEqual({
    model: 'gpt-6.1-sol',
    effort: 'high',
    sandbox: 'read-only',
    prompt: 'Review pkg/auth.',
    tokens: { input: 25000, output: 3000, cached: 18000 },
    commandCount: 1,
    steps: [
      { kind: 'message', text: 'I will read the diff first.' },
      { kind: 'reasoning', text: '**Checking verify.ts**' },
      { kind: 'command', text: 'git diff main', exitCode: 0, lines: 3 },
      { kind: 'command', text: 'rg -n "redact" pkg', isRunning: true },
    ],
  })
})

test('an empty or broken rollout gives no fields', () => {
  expect(parseRollout('not json\n')).toEqual({ steps: [], commandCount: 0 })
})

test('job states map to item states', () => {
  expect(jobEnd('running')).toBeUndefined()
  expect(jobEnd('queued')).toBeUndefined()
  expect(jobEnd('completed')).toBe('done')
  expect(jobEnd('failed')).toBe('failed')
  expect(jobEnd('cancelled')).toBe('stopped')
})

test('a job without a session file keeps the job fields and leaves no undefined keys', () => {
  const item = codexItem(
    { id: 'task-1', summary: 'Review pkg/db\nmore', startedAt: '1970-01-01T00:00:01.000Z' },
    undefined,
  )
  expect(item).toEqual({
    id: 'codex:task-1',
    kind: 'codex',
    title: 'Review pkg/db',
    status: 'running',
    startedAt: 1000,
    detail: { jobId: 'task-1' },
  })
})

const HOME = '/home/u'
const STATE = `${HOME}/.claude/plugins/data/codex-openai-codex/state`
const WS = `${STATE}/rabe-0123456789abcdef`
const OTHER = `${STATE}/other-fedcba9876543210`
const SESSIONS = `${HOME}/.codex/sessions/1970/01/01`
const ROLLOUT_PATH = `${SESSIONS}/rollout-1970-01-01T00-00-01-th-1.jsonl`
const PLUGIN = `${HOME}/.claude/plugins/cache/openai-codex/codex/1.0.6`

type Job = Record<string, unknown>

function job(over: Job = {}): Job {
  return {
    id: 'task-1',
    kindLabel: 'rescue',
    title: 'Codex Task',
    summary: 'Review pkg/auth after the logger migration.',
    workspaceRoot: '/work/rabe',
    sessionId: 'sess-1',
    status: 'running',
    startedAt: '1970-01-01T00:00:01.000Z',
    logFile: `${WS}/jobs/task-1.log`,
    threadId: 'th-1',
    request: { model: 'gpt-6.1-sol', effort: 'high', prompt: 'Review pkg/auth.' },
    ...over,
  }
}

type World = {
  files: Map<string, { text: string; mtimeMs: number; size?: number }>
  clock: MockClock
}

function world(on: On, files: Record<string, string | object>, mtimeMs = 5000): World {
  const held: World = { files: new Map(), clock: mock.clock(on, { now: 10_000 }) }
  for (const [path, text] of Object.entries(files)) {
    held.files.set(path, { text: typeof text === 'string' ? text : JSON.stringify(text), mtimeMs })
  }
  mock.env(on, { HOME })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.usage', async () => ({ value: { startedAt: 1000, rateLimits: [] } }) as never)
  on('fs.list', async (_$, e) => {
    const prefix = `${e.path}/`
    const names = new Set<string>()
    for (const path of held.files.keys()) {
      if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0] as string)
    }
    if (names.size === 0) return { deny: 'ENOENT' }
    return {
      value: [...names].map(name => ({
        name,
        kind: held.files.has(prefix + name) ? ('file' as const) : ('dir' as const),
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    }
  })
  on('fs.stat', async (_$, e) => {
    const file = held.files.get(e.path)
    if (!file) return { deny: 'ENOENT' }
    return {
      value: {
        kind: 'file',
        size: file.size ?? file.text.length,
        mtimeMs: file.mtimeMs,
        isLink: false,
      },
    }
  })
  on('fs.read', async (_$, e) => {
    const file = held.files.get(e.path)
    return file ? { value: file.text } : { deny: 'ENOENT' }
  })
  return held
}

function watchItems(on: On): RabeItem[][] {
  const writes: RabeItem[][] = []
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'rabe' && e.key === 'items') writes.push(e.value as RabeItem[])
    return next(e)
  })
  return writes
}

async function startAndTick($: Engine, w: World) {
  await $.session.start({ cwd: '/work/rabe', surface: 'terminal', isInteractive: true })
  await w.clock.advance(2000)
}

test('a running job of this session becomes a live codex item', async ($, on) => {
  const writes = watchItems(on)
  const w = world(on, {
    [`${WS}/state.json`]: {
      jobs: [
        { id: 'task-1', status: 'running' },
        job({ id: 'task-x', sessionId: 'other' }),
        { id: 'task-y', status: 'running' },
      ],
    },
    [`${WS}/jobs/task-1.json`]: job(),
    [`${WS}/jobs/task-y.json`]: job({ id: 'task-y', sessionId: 'other' }),
    [`${OTHER}/state.json`]: { jobs: [job({ id: 'task-old' })] },
    [ROLLOUT_PATH]: ROLLOUT,
  })
  w.files.set(`${OTHER}/state.json`, { text: '{"jobs":[]}', mtimeMs: 10 })
  await startAndTick($, w)
  const items = writes.at(-1) ?? []
  expect(items.map(item => item.id)).toEqual(['codex:task-1'])
  expect(items[0]).toMatchObject({
    kind: 'codex',
    status: 'running',
    title: 'Review pkg/auth after the logger migration.',
    startedAt: 1000,
    tokens: { input: 25000, output: 3000, cached: 18000 },
    detail: {
      jobId: 'task-1',
      jobKind: 'rescue',
      threadId: 'th-1',
      model: 'gpt-6.1-sol',
      effort: 'high',
      sandbox: 'read-only',
      prompt: 'Review pkg/auth.',
      workspaceRoot: '/work/rabe',
      logPath: `${WS}/jobs/task-1.log`,
      sessionPath: ROLLOUT_PATH,
      sessionUpdatedAt: 5000,
      commandCount: 1,
    },
  })
})

test('an unchanged session file causes no second write', async ($, on) => {
  const writes = watchItems(on)
  const w = world(on, {
    [`${WS}/state.json`]: { jobs: [job()] },
    [`${WS}/jobs/task-1.json`]: job(),
    [ROLLOUT_PATH]: ROLLOUT,
  })
  await startAndTick($, w)
  await w.clock.advance(4000)
  expect(writes).toHaveLength(1)
})

test('a finished job ends its item; a gone session file shows as missing', async ($, on) => {
  const writes = watchItems(on)
  const w = world(on, {
    [`${WS}/state.json`]: { jobs: [job()] },
    [`${WS}/jobs/task-1.json`]: job({
      status: 'completed',
      completedAt: '1970-01-01T00:00:09.000Z',
    }),
    [`${SESSIONS}/rollout-other.jsonl`]: '',
  })
  await startAndTick($, w)
  expect(writes.at(-1)?.[0]).toMatchObject({
    status: 'done',
    endedAt: 9000,
    detail: { model: 'gpt-6.1-sol', isSessionMissing: true },
  })
})

test('a session file over 4 MiB is read with grep and tail', async ($, on) => {
  const writes = watchItems(on)
  const w = world(on, {
    [`${WS}/state.json`]: { jobs: [job()] },
    [`${WS}/jobs/task-1.json`]: job(),
    [ROLLOUT_PATH]: '',
  })
  w.files.set(ROLLOUT_PATH, { text: '', mtimeMs: 5000, size: 5 * 1024 * 1024 })
  const runs: string[][] = []
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    const [head, tail] = ROLLOUT.split('\n').reduce<[string[], string[]]>(
      ([h, t], one, n) => (n < 3 ? [[...h, one], t] : [h, [...t, one]]),
      [[], []],
    )
    return {
      value: {
        exitCode: 0,
        stdout: `${(e.argv[0] === 'grep' ? head : tail).join('\n')}\n`,
        stderr: '',
      },
    } as never
  })
  await startAndTick($, w)
  expect(runs.map(argv => argv[0])).toEqual(['grep', 'tail'])
  expect(writes.at(-1)?.[0]).toMatchObject({
    detail: { model: 'gpt-6.1-sol', isSessionPartial: true, commandCount: 1 },
  })
})

test('/rabe-stop cancels the job through the companion script', async ($, on) => {
  const w = world(on, {
    [`${WS}/state.json`]: { jobs: [job()] },
    [`${WS}/jobs/task-1.json`]: job(),
    [ROLLOUT_PATH]: ROLLOUT,
    [`${HOME}/.claude/plugins/installed_plugins.json`]: {
      plugins: { 'codex@openai-codex': [{ installPath: PLUGIN }] },
    },
  })
  const runs: { argv: string[]; env?: Record<string, string> }[] = []
  on('process.run', async (_$, e) => {
    runs.push({ argv: [...e.argv], env: e.init?.env })
    return { value: { exitCode: 0, stdout: '{}', stderr: '' } } as never
  })
  await startAndTick($, w)
  const answer = await $.command.run({ command: 'rabe-stop', args: 'codex:task-1' } as never)
  expect(runs).toEqual([
    {
      argv: [
        'node',
        `${PLUGIN}/scripts/codex-companion.mjs`,
        'cancel',
        'task-1',
        '--json',
        '--cwd',
        '/work/rabe',
      ],
      env: { CLAUDE_PLUGIN_DATA: `${HOME}/.claude/plugins/data/codex-openai-codex` },
    },
  ])
  expect(answer).toEqual({ text: 'Stopped codex Review pkg/auth after the logger migration.' })
})

test('an unchanged session file keeps the model and effort it gave', () => {
  const item = codexItem({ ...job(), id: 'task-1' }, { path: ROLLOUT_PATH, updatedAt: 5000 })
  expect(item.detail).not.toHaveProperty('model')
  expect(item.detail).not.toHaveProperty('effort')
})

test('a session file that cannot be read still lets the job end', async ($, on) => {
  on('fs.read', { path: ROLLOUT_PATH }, async () => ({ deny: 'EACCES' }))
  const writes = watchItems(on)
  const w = world(on, {
    [`${WS}/state.json`]: { jobs: [job()] },
    [`${WS}/jobs/task-1.json`]: job({
      status: 'completed',
      completedAt: '1970-01-01T00:00:09.000Z',
    }),
    [ROLLOUT_PATH]: ROLLOUT,
  })
  await startAndTick($, w)
  expect(writes.at(-1)?.[0]).toMatchObject({ status: 'done', endedAt: 9000 })
})

test('a finished job the cap dropped is not read or added again', async ($, on) => {
  const state = memoryState(on)
  state['rabe.evicted'] = { value: ['codex:task-1'], version: 1 }
  const reads: string[] = []
  on('fs.read', { path: /\/jobs\// }, async (_$, e, next) => {
    reads.push(e.path)
    return next(e)
  })
  const w = world(on, {
    [`${WS}/state.json`]: { jobs: [{ id: 'task-1', status: 'completed' }, job({ id: 'task-2' })] },
    [`${WS}/jobs/task-1.json`]: job({ status: 'completed' }),
    [`${WS}/jobs/task-2.json`]: job({ id: 'task-2' }),
    [ROLLOUT_PATH]: ROLLOUT,
  })
  await startAndTick($, w)
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items.map(item => item.id)).toEqual(['codex:task-2'])
  expect(reads).toEqual([`${WS}/jobs/task-2.json`])
})
