import type { On } from 'claude-code'
import { expect, mock, type TestBody, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { MAX_ENDED } from '../registry'
import { core, memoryState, overCap } from '../testing'
import { cronFires } from './crons'

const JOB = {
  id: 'c1',
  cron: '*/5 * * * *',
  humanSchedule: 'every 5 minutes',
  prompt: '/babysit-prs',
}

function tools(on: On, jobs = [JOB]) {
  on(
    'tool.call',
    { tool: ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'] },
    async (_$, e) => {
      if (e.tool === 'CronCreate') {
        return { result: { id: 'c1', humanSchedule: 'every 5 minutes', recurring: true } }
      }
      if (e.tool === 'CronDelete') return { result: { id: e.id } }
      if (e.tool === 'CronList') return { result: { jobs } }

      return e.tool === 'ScheduleWakeup' && e.stop
        ? { result: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false, stopped: true } }
        : {
            result: {
              scheduledFor: 1000 + (e.tool === 'ScheduleWakeup' ? (e.delaySeconds ?? 0) * 1000 : 0),
              clampedDelaySeconds: 60,
              wasClamped: false,
            },
          }
    },
  )
}

const cron = {
  id: 'cron:c1',
  kind: 'cron',
  title: '/babysit-prs',
  status: 'running',
  seenAt: 1000,
  startedAt: 1000,
  detail: {
    jobId: 'c1',
    prompt: '/babysit-prs',
    schedule: '*/5 * * * *',
    humanSchedule: 'every 5 minutes',
  },
}

test('a CronCreate call adds a running cron job', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: '/babysit-prs' })
  expect(state['rabe.items']?.value).toEqual([cron])
})

test('a CronDelete call records that the job was deleted', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: '/babysit-prs' })
  await clock.set(2000)
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  expect(state['rabe.items']?.value).toEqual([
    { ...cron, status: 'stopped', endedAt: 2000, detail: { ...cron.detail, isDeleted: true } },
  ])
})

test('a wakeup shows when it fires, and the next one replaces it', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  const wake = { delaySeconds: 60, reason: 'check CI', prompt: '/loop check CI', noop: false }
  await $.tool.call({ tool: 'ScheduleWakeup', ...wake })
  const first = {
    id: 'cron:wakeup-61000',
    kind: 'cron',
    title: '/loop check CI',
    status: 'running',
    seenAt: 1000,
    startedAt: 1000,
    detail: { jobId: 'wakeup-61000', prompt: '/loop check CI', scheduledFor: 61000 },
  }
  expect(state['rabe.items']?.value).toEqual([first])
  await clock.set(61000)
  await $.prompt.submit({
    text: '/loop check CI',
    origin: { kind: 'scheduled-trigger' },
    wait: false,
  })
  expect(state['rabe.items']?.value).toEqual([{ ...first, status: 'done', endedAt: 61000 }])
  await $.tool.call({ tool: 'ScheduleWakeup', ...wake, delaySeconds: 120 })
  await $.tool.call({ tool: 'ScheduleWakeup', stop: true })
  const items = state['rabe.items']?.value as { id: string; status: string }[]
  expect(items.map(item => [item.id, item.status])).toEqual([
    ['cron:wakeup-61000', 'done'],
    ['cron:wakeup-121000', 'stopped'],
  ])
})

// The texts Claude Code 2.1.295 fires for the two autonomous loops, shortened.
const RECURRING_TICK = `# Autonomous loop tick

Run the autonomous check using the loop instructions established earlier in this conversation. The recurring cron will fire the next tick automatically — do not call ScheduleWakeup from this tick.`
const DYNAMIC_TICK = `# Autonomous loop tick (dynamic pacing)

You scheduled this tick via the ScheduleWakeup tool (not a recurring cron). To keep the loop alive, call ScheduleWakeup again this turn with \`prompt\` set to the literal sentinel \`<<autonomous-loop-dynamic>>\` and \`noop\` set to \`true\` if this tick changed nothing.`

test('a fired prompt ends a due wakeup only when it is its prompt or names its sentinel', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: '<<autonomous-loop>>' })
  await $.tool.call({
    tool: 'ScheduleWakeup',
    delaySeconds: 600,
    reason: 'r',
    prompt: '<<autonomous-loop-dynamic>>',
    noop: false,
  })
  const fire = (text: string) =>
    $.prompt.submit({ text, origin: { kind: 'scheduled-trigger' }, wait: false })
  const status = () =>
    ((state['rabe.items']?.value ?? []) as { id: string; status: string }[]).map(one => one.status)

  // Not due yet: even its own text ends nothing.
  await fire(DYNAMIC_TICK)
  expect(status()).toEqual(['running', 'running'])

  // Due: the recurring loop's tick and other text are no evidence.
  await clock.set(601_000)
  await fire(RECURRING_TICK)
  await fire('/babysit-prs')
  expect(status()).toEqual(['running', 'running'])

  // Its own tick names its sentinel.
  await fire(DYNAMIC_TICK)
  expect(status()).toEqual(['running', 'done'])
})

test('a /loop wakeup ends on its own prompt, not on an autonomous tick', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.tool.call({
    tool: 'ScheduleWakeup',
    delaySeconds: 60,
    reason: 'r',
    prompt: '/loop check CI',
    noop: false,
  })
  const fire = (text: string) =>
    $.prompt.submit({ text, origin: { kind: 'scheduled-trigger' }, wait: false })
  const status = () =>
    ((state['rabe.items']?.value ?? []) as { id: string; status: string }[]).map(one => one.status)
  await clock.set(61_000)
  await fire(DYNAMIC_TICK)
  await fire(RECURRING_TICK)
  expect(status()).toEqual(['running'])
  await fire('/loop check CI')
  expect(status()).toEqual(['done'])
})

test('the autonomous loop sentinel gets a plain title', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.tool.call({
    tool: 'ScheduleWakeup',
    delaySeconds: 60,
    reason: 'idle',
    prompt: '<<autonomous-loop-dynamic>>',
    noop: true,
  })
  const items = state['rabe.items']?.value as { title: string }[]
  expect(items[0]?.title).toBe('autonomous loop')
})

test('at session start CronList adds jobs made before Rabe loaded', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  const { startedAt: _, ...listed } = cron
  expect(state['rabe.items']?.value).toEqual([listed])
})

test('at Stop a job gone from the session crons ends, a new one is added', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: '/babysit-prs' })
  await $.tool.call({
    tool: 'ScheduleWakeup',
    delaySeconds: 60,
    reason: 'r',
    prompt: '/loop x',
    noop: false,
  })
  await clock.set(9000)
  await $.classic.Stop({
    stop_hook_active: false,
    session_crons: [
      { id: 'c2', schedule: '30 14 28 2 *', recurring: false, prompt: 'remind me' },
      { id: 'w1', schedule: '1 0 1 1 *', recurring: false, prompt: '/loop x' },
    ],
  })
  const items = state['rabe.items']?.value as { id: string; status: string }[]
  expect(items.map(item => [item.id, item.status])).toEqual([
    ['cron:c1', 'done'],
    ['cron:wakeup-61000', 'running'],
    ['cron:c2', 'running'],
  ])
})

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

test('an item a hook write pushes out loses its lines and turns, though its output never changed', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: full(), version: 1 }
  state['rabe.lines'] = { value: { 'shell:s1': lines, 'shell:s5': lines }, version: 1 }
  state['rabe.turns'] = { value: { 'agent:a0': turns }, version: 1 }
  tools(on)

  // A cron job ending pushes the oldest ended item, an agent, out of the list.
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  expect(state['rabe.turns']?.value).toEqual({})
  expect(state['rabe.lines']?.value).toEqual({ 'shell:s1': lines, 'shell:s5': lines })

  // The next one pushes out shell s1: its lines go, those of s5 stay.
  await $.tool.call({ tool: 'CronDelete', id: 'c2' })
  expect(state['rabe.lines']?.value).toEqual({ 'shell:s5': lines })
})

test('a write that drops nothing leaves lines and turns alone', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: full().slice(1), version: 1 }
  state['rabe.lines'] = { value: { 'shell:s1': lines }, version: 1 }
  state['rabe.turns'] = { value: {}, version: 1 }
  tools(on)
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  expect(state['rabe.lines']).toEqual({ value: { 'shell:s1': lines }, version: 1 })
  expect(state['rabe.turns']).toEqual({ value: {}, version: 1 })
})

test('pruning after a write keeps the output of an item a later write added', async ($, on) => {
  mock.clock(on, { now: 5000 })
  let release = () => {}
  let reached = () => {}
  const paused = new Promise<void>(resolve => {
    reached = resolve
  })
  let gated = false
  on('state.get', { plugin: 'rabe', key: 'lines' }, async (_$, e, next) => {
    if (gated) return next(e)
    gated = true
    reached()
    await new Promise<void>(resolve => {
      release = resolve
    })
    return next(e)
  })
  const state = memoryState(on)
  state['rabe.items'] = { value: full(), version: 1 }
  state['rabe.lines'] = { value: { 'shell:s1': lines }, version: 1 }
  state['rabe.turns'] = { value: { 'agent:a0': turns }, version: 1 }
  tools(on)

  // The write that ends c1 lands and drops agent a0. Before it prunes, another
  // task is added and stores its output, and a0 runs again under the same id.
  const ending = $.tool.call({ tool: 'CronDelete', id: 'c1' })
  await paused
  const items = (state['rabe.items']?.value ?? []) as RabeItem[]
  expect(items.some(item => item.id === 'agent:a0')).toBe(false)
  const added = { ...items[1], id: 'shell:new' } as RabeItem
  const back = { ...full()[0], status: 'running' } as RabeItem
  state['rabe.items'] = { value: [...items, added, back], version: 9 }
  state['rabe.lines'] = { value: { 'shell:s1': lines, 'shell:new': lines }, version: 9 }
  state['rabe.turns'] = { value: { 'agent:a0': turns, 'shell:new': turns }, version: 9 }
  release()
  await ending
  expect(state['rabe.lines']?.value).toEqual({ 'shell:s1': lines, 'shell:new': lines })
  expect(state['rabe.turns']?.value).toEqual({ 'agent:a0': turns, 'shell:new': turns })
})

test('pruning after a write still drops the entries of the item it dropped', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: full(), version: 1 }
  state['rabe.turns'] = { value: { 'agent:a0': turns, 'shell:new': turns }, version: 1 }
  tools(on)
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  expect(state['rabe.turns']?.value).toEqual({ 'shell:new': turns })
})

const fireRows = [
  {
    type: 'system',
    subtype: 'scheduled_task_fire',
    uuid: 'f1',
    taskId: 'c1',
    timestamp: '2026-10-09T00:24:08.132Z',
  },
  {
    type: 'user',
    uuid: 'u1',
    parentUuid: 'f1',
    scheduledTaskId: 'c1',
    scheduledFireId: 'f1',
    message: { content: 'tick' },
  },
]
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n')

test('cron fires use exact fire ids, count each fire once and ignore tool results', () => {
  const rows = [
    ...fireRows,
    ...fireRows,
    { type: 'user', uuid: 'tool', message: { content: [{ type: 'tool_result' }] } },
  ]
  expect(cronFires(jsonl(rows))).toEqual({
    jobs: {
      c1: { lastFiredAt: Date.parse('2026-10-09T00:24:08.132Z'), fireCount: 1, fireId: 'f1' },
    },
    promptId: 'u1',
    jobId: 'c1',
    fireId: 'f1',
  })
})

test('ambiguous, wrong-id, invalid-time and sidechain fires show nothing', () => {
  for (const rows of [
    [fireRows[0], { ...fireRows[1], scheduledTaskId: 'other' }],
    [{ ...fireRows[0], timestamp: 'bad' }, fireRows[1]],
    fireRows.map(row => ({ ...row, isSidechain: true })),
    [...fireRows, { ...fireRows[1], uuid: 'u2' }],
  ])
    expect(cronFires(jsonl(rows)).jobs).toEqual({})
})

test('filtered fire rows keep the fire user UUID when an ordinary prompt is absent', () => {
  const read = cronFires(
    jsonl([...fireRows, { type: 'user', uuid: 'person', message: { content: 'hello' } }])
      .split('\n')
      .filter(line => line.includes('"scheduled_task_fire"') || line.includes('"scheduledFireId"'))
      .join('\n'),
  )
  expect(read.promptId).toBe('u1')
  expect(read.jobId).toBe('c1')
  expect(read.jobs.c1?.fireCount).toBe(1)
})

test('a main cron turn keeps its API end word and ignores subagent completion', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  const path = '/home/me/.claude/projects/-home-me-app/session-1.jsonl'
  const disk = { [path]: jsonl(fireRows) }
  let exitCode = 0
  let isStdoutTruncated = false
  let reads = 0
  on('process.run', async (_$, e) => {
    reads++
    expect(e.argv).toEqual([
      'grep',
      '-F',
      '-e',
      '"scheduled_task_fire"',
      '-e',
      '"scheduledFireId"',
      '--',
      path,
    ])
    expect(e.init?.timeoutMs).toBe(5000)
    return {
      value: {
        exitCode,
        stdout: disk[path]
          .split('\n')
          .filter(
            line => line.includes('"scheduled_task_fire"') || line.includes('"scheduledFireId"'),
          )
          .join('\n'),
        stderr: '',
        isStdoutTruncated,
        isStderrTruncated: false,
      },
    }
  })
  const append = (uuid: string) =>
    $.session.append({
      door: 'prompt',
      uuid,
      origin: { kind: 'composer' },
      message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'tick' }] },
    })
  // biome-ignore lint/correctness/useYield: the engine stand-in has no chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        model: 'm',
      },
    }
  })
  on('turn.complete', async () => ({ text: '' }))
  await $.tool.call({ tool: 'CronCreate', cron: JOB.cron, prompt: JOB.prompt })
  await $.classic.Stop({ stop_hook_active: false, transcript_path: path })
  const transcript = state['rabe.cronTranscript']
  await $.classic.Stop({ stop_hook_active: false, transcript_path: path })
  await $.classic.Stop({
    stop_hook_active: false,
    transcript_path: '/other/agent.jsonl',
    agent_id: 'a1',
  })
  expect(state['rabe.cronTranscript']).toEqual(transcript)
  expect(transcript?.value).toBe(path)
  await append('u1')
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 }));
  const complete = {
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer' as const,
  }
  await $.turn.complete({ ...complete, agentId: 'a1' })
  expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.detail).not.toHaveProperty(
    'turnEnded',
  )
  for (const [reason, word] of [
    ['answer', 'answered'],
    ['aborted', 'stopped'],
    ['error', 'error'],
    ['refusal', 'refused'],
  ] as const) {
    await append('u1')
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 }));
    await $.turn.complete({
      ...complete,
      reason,
      isAborted: reason === 'aborted',
      ...(reason === 'refusal' && { refusal: { category: null, explanation: null } }),
    } as Parameters<typeof $.turn.complete>[0])
    expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]).toMatchObject({
      status: 'running',
      detail: { fireCount: 1, turnEnded: word },
    })
  }
  // A new fire clears the previous end. A later person prompt makes its end ambiguous.
  const nextFire = [
    { ...fireRows[0], uuid: 'f2', timestamp: '2026-10-09T00:28:53.361Z' },
    { ...fireRows[1], uuid: 'u2', parentUuid: 'f2', scheduledFireId: 'f2' },
  ]
  disk[path] = jsonl([...fireRows, ...nextFire])
  await append('u2')
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'm', messageCount: 1 }));
  disk[path] += `\n${jsonl([{ type: 'user', uuid: 'person', message: { content: 'hello' } }])}`
  await append('person')
  await $.turn.complete({ ...complete, turnId: 't2' })
  const detail = ((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.detail
  expect(detail).toMatchObject({
    fireCount: 2,
    lastFiredAt: Date.parse('2026-10-09T00:28:53.361Z'),
  })
  expect((detail as { turnEnded?: string }).turnEnded).toBe(undefined)
  await append('person')
  for await (const _ of $.turn.step({ turnId: 't3', index: 0, model: 'm', messageCount: 1 }));
  await $.turn.complete({ ...complete, turnId: 't3' })
  expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.detail).not.toHaveProperty(
    'turnEnded',
  )
  for (const invalid of ['relative.jsonl', '/absolute.txt', '']) {
    await $.classic.Stop({ stop_hook_active: false, transcript_path: invalid })
    const before = reads
    for await (const _ of $.turn.step({ turnId: 't4', index: 0, model: 'm', messageCount: 1 }));
    expect(reads).toBe(before)
  }
  await $.classic.Stop({ stop_hook_active: false, transcript_path: path })
  const before = state['rabe.items']
  isStdoutTruncated = true
  for await (const _ of $.turn.step({ turnId: 't4', index: 0, model: 'm', messageCount: 1 }));
  expect(state['rabe.items']).toEqual(before)
  isStdoutTruncated = false
  exitCode = 2
  for await (const _ of $.turn.step({ turnId: 't4', index: 0, model: 'm', messageCount: 1 }));
  expect(state['rabe.items']).toEqual(before)
  disk[path] = ''
  exitCode = 1
  for await (const _ of $.turn.step({ turnId: 't4', index: 0, model: 'm', messageCount: 1 }));
  expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.detail).not.toHaveProperty(
    'fireCount',
  )
})

const PATH = '/home/me/.claude/projects/-home-me-app/session-1.jsonl'

// A session with one cron job, a fake transcript and a grep that can be held.
// `snapshot` makes state.get answer from the moment the grep is held, as the
// engine does within one dispatch ("every get of one dispatch reads one moment").
async function scanSession(
  $: Parameters<TestBody>[0],
  on: On,
  jobs = [JOB],
  snapshot = false,
  known = true,
) {
  const clock = mock.clock(on, { now: 1000 })
  const state: Record<string, { value: unknown; version: number }> = {}
  let frozen: typeof state | undefined
  on('state.get', async (_$, e) => {
    const value = (snapshot && e.key === 'cronTurn' ? frozen : undefined)?.[
      `${e.plugin}.${e.key}`
    ] ??
      state[`${e.plugin}.${e.key}`] ?? { value: undefined, version: 0 }
    const hold = e.key === 'cronTurn' ? run.holdGet : undefined
    if (hold) {
      run.holdGet = undefined
      run.getEntered()
      await hold
    }

    return { value }
  })
  on('state.set', async (_$, e) => {
    const name = `${e.plugin}.${e.key}`
    const version = state[name]?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) {
      return { value: { isSet: false as const, version } }
    }
    state[name] = { value: e.value, version: version + 1 }

    return { value: { isSet: true as const, version: version + 1 } }
  })
  tools(on, jobs)
  core(on)
  const rows: unknown[] = [...fireRows]
  const run = {
    reads: 0,
    holdGet: undefined as Promise<void> | undefined,
    getEntered: () => {},
    hold: undefined as Promise<void> | undefined,
    entered: () => {},
    thaw: () => {
      frozen = undefined
    },
  }
  on('process.run', async () => {
    run.reads++
    const hold = run.hold
    if (hold) {
      frozen = structuredClone(state)
      run.entered()
    }
    const stdout = rows.map(row => JSON.stringify(row)).join('\n')
    await hold
    return {
      value: {
        exitCode: 0,
        stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  // biome-ignore lint/correctness/useYield: the engine stand-in has no chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        model: 'm',
      },
    }
  })
  on('turn.complete', async () => ({ text: '' }))
  const append = (uuid: string) =>
    $.session.append({
      door: 'prompt',
      uuid,
      origin: { kind: 'composer' },
      message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'tick' }] },
    })
  const step = async (turnId: string) => {
    for await (const _ of $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1 }));
  }
  const complete = (turnId: string, durationMs = 1) =>
    $.turn.complete({
      answer: '',
      durationMs,
      isAborted: false,
      turnId,
      reason: 'answer' as const,
    })
  const detail = () => ((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.detail
  await $.tool.call({ tool: 'CronCreate', cron: JOB.cron, prompt: JOB.prompt })
  if (known) await $.classic.Stop({ stop_hook_active: false, transcript_path: PATH })
  return { state, run, rows, append, step, complete, detail, clock }
}

for (const snapshot of [false, true]) {
  test(`a prompt that arrives during the completion scan keeps the turn from recording an end (snapshot reads: ${snapshot})`, async ($, on) => {
    const s = await scanSession($, on, [JOB], snapshot)
    await s.append('u1')
    await s.step('t1')
    let release = () => {}
    s.run.hold = new Promise<void>(resolve => {
      release = resolve
    })
    const entered = new Promise<void>(resolve => {
      s.run.entered = resolve
    })
    const done = s.complete('t1')
    await entered
    await s.append('person-1')
    release()
    await done
    s.run.thaw()
    expect(s.state['rabe.cronTurn']?.value).toEqual({ promptId: 'person-1' })
    expect(s.detail()).not.toHaveProperty('turnEnded')
  })
}

test('a deleted cron stops the transcript scans of later turns', async ($, on) => {
  const s = await scanSession($, on)
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  await s.clock.advance(100)
  s.run.reads = 0
  for (let i = 0; i < 5; i++) {
    await s.append(`person-${i}`)
    await s.step(`t${i}`)
    await s.complete(`t${i}`)
  }
  expect(s.run.reads).toBe(0)
})

test('a cron that ends during its own fire turn still records the turn end', async ($, on) => {
  const s = await scanSession($, on)
  await s.append('u1')
  await s.step('t1')
  await $.classic.Stop({ stop_hook_active: false, transcript_path: PATH, session_crons: [] })
  expect(((s.state['rabe.items']?.value ?? []) as RabeItem[])[0]?.status).not.toBe('running')
  await s.complete('t1')
  expect(s.detail()).toMatchObject({ turnEnded: 'answered' })
})

test('a cron that ended before any transcript path was known still gets its fire details', async ($, on) => {
  const s = await scanSession($, on, [JOB], false, false)
  await s.append('u1')
  await s.step('t1')
  expect(s.run.reads).toBe(0)
  await $.classic.Stop({ stop_hook_active: false, transcript_path: PATH, session_crons: [] })
  await s.complete('t1')
  expect(s.detail()).toMatchObject({ fireCount: 1 })
})

test('a prompt that arrives while the first completion read is held keeps the turn from recording an end', async ($, on) => {
  const s = await scanSession($, on)
  await s.append('u1')
  await s.step('t1')
  let release = () => {}
  s.run.holdGet = new Promise<void>(resolve => {
    release = resolve
  })
  const entered = new Promise<void>(resolve => {
    s.run.getEntered = resolve
  })
  const done = s.complete('t1')
  await entered
  await s.append('person-1')
  release()
  await done
  expect(s.detail()).not.toHaveProperty('turnEnded')
})

test('a running cron whose first turn had no transcript path gets its fire details at completion', async ($, on) => {
  const s = await scanSession($, on, [JOB], false, false)
  await s.append('u1')
  await s.step('t1')
  expect(s.run.reads).toBe(0)
  await $.classic.Stop({ stop_hook_active: false, transcript_path: PATH })
  await s.complete('t1')
  expect(s.detail()).toMatchObject({ fireCount: 1 })
  expect(s.detail()).not.toHaveProperty('turnEnded')
})

test('a cron that ended inside a turn is read even when the turn took longer than the clock suggests', async ($, on) => {
  const s = await scanSession($, on, [JOB], false, false)
  await s.append('u1')
  await s.step('t1')
  await s.clock.advance(10)
  await $.classic.Stop({ stop_hook_active: false, transcript_path: PATH, session_crons: [] })
  await s.clock.advance(110)
  await s.complete('t1', 100)
  expect(s.detail()).toMatchObject({ fireCount: 1 })
})

test('a never-fired ended cron causes no scans on later unrelated turns', async ($, on) => {
  const s = await scanSession($, on)
  await $.classic.Stop({ stop_hook_active: false, transcript_path: PATH, session_crons: [] })
  await s.clock.advance(100)
  s.run.reads = 0
  for (let i = 0; i < 3; i++) {
    await s.append(`person-${i}`)
    await s.step(`t${i}`)
    await s.complete(`t${i}`)
  }
  expect(s.run.reads).toBe(0)
})

// The next fire of job c1, as the transcript holds it once Claude Code wrote it.
const secondFire = [
  { ...fireRows[0], uuid: 'f2', timestamp: '2026-10-09T00:25:08.132Z' },
  { ...fireRows[1], uuid: 'u2', parentUuid: 'f2', scheduledFireId: 'f2' },
]

test('a fire row that reaches the transcript after the first step still updates the detail and records the turn end', async ($, on) => {
  const s = await scanSession($, on)
  await s.append('u1')
  await s.step('t1')
  await s.complete('t1')
  expect(s.detail()).toMatchObject({ fireCount: 1, turnEnded: 'answered' })
  await s.append('u2')
  await s.step('t2')
  expect(s.detail()).toMatchObject({ fireCount: 1 })
  s.rows.push(...secondFire)
  await s.complete('t2')
  expect(s.detail()).toMatchObject({
    fireCount: 2,
    fireId: 'f2',
    lastFiredAt: Date.parse('2026-10-09T00:25:08.132Z'),
    turnEnded: 'answered',
  })
})

test('a late fire row read at the completion of another prompt updates the count but gives no end word', async ($, on) => {
  const s = await scanSession($, on)
  await s.append('u1')
  await s.step('t1')
  await s.complete('t1')
  await s.append('person-1')
  await s.step('t2')
  s.rows.push(...secondFire)
  await s.complete('t2')
  expect(s.detail()).toMatchObject({ fireCount: 2, fireId: 'f2' })
  expect(s.detail()).not.toHaveProperty('turnEnded')
})

test('a scheduled prompt whose fire row reaches the transcript after the first step still records the turn end', async ($, on) => {
  const s = await scanSession($, on)
  await s.append('u1')
  await s.step('t1')
  await s.complete('t1')
  await s.append('u2')
  s.rows.push(secondFire[1])
  await s.step('t2')
  s.rows.push(secondFire[0])
  await s.complete('t2')
  expect(s.detail()).toMatchObject({ fireCount: 2, fireId: 'f2', turnEnded: 'answered' })
})

test('a late fire pair still updates the count when another prompt replaced the turn link and the cron was deleted', async ($, on) => {
  const s = await scanSession($, on)
  await s.append('u1')
  await s.step('t1')
  await s.complete('t1')
  await s.clock.advance(100)
  await s.append('u2')
  await s.step('t2')
  await s.append('person-1')
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  s.rows.push(...secondFire)
  await s.complete('t2')
  expect(s.detail()).toMatchObject({ fireCount: 2, fireId: 'f2' })
  expect(s.detail()).not.toHaveProperty('turnEnded')
})

test('an item a hook write pushes out loses its diffs, though it has no turns', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: full(), version: 1 }
  const { diffs } = overCap(0)
  state['rabe.diffs'] = {
    value: { 'agent:a0': diffs['shell:old0'], 'shell:s5': diffs['shell:old1'] },
    version: 1,
  }
  tools(on)
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  expect(state['rabe.diffs']?.value).toEqual({ 'shell:s5': diffs['shell:old1'] })
})
