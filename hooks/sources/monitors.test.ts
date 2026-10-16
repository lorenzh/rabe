import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { MAX_ENDED } from '../registry'
import { core, files, memoryState, overCap } from '../testing'

const DIR = '/tmp/claude-1000/-home-me-app/5f1c/tasks'
const OUT = `${DIR}/m1.output`

function tools(on: On) {
  on('session.id', async () => ({ value: '5f1c' }))
  on('session.root', async () => ({ value: '/home/me/app' }))
  on('tool.call', { tool: ['Monitor', 'Bash'] }, async (_$, e) =>
    e.tool === 'Monitor'
      ? { result: { taskId: 'm1', timeoutMs: 1_800_000 }, text: 'Monitor started (task m1)' }
      : {
          result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
          text: `Output is being written to: ${DIR}/b1.output.`,
        },
  )
}

async function arm($: Engine) {
  await $.tool.call({
    tool: 'Monitor',
    description: 'CI run 482',
    command: 'gh run watch 482 --exit-status',
    timeout_ms: 1_800_000,
  })
}

const watching = {
  id: 'monitor:m1',
  kind: 'monitor',
  title: 'CI run 482',
  status: 'running',
  seenAt: 1000,
  startedAt: 1000,
  detail: {
    command: 'gh run watch 482 --exit-status',
    description: 'CI run 482',
    taskId: 'm1',
    timeoutMs: 1_800_000,
    isPersistent: false,
  },
}

test('a Monitor call adds a running monitor', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await arm($)
  expect(state['rabe.items']?.value).toEqual([watching])
})

test('the output file is found beside a known shell output', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await arm($)
  const items = state['rabe.items']?.value as { detail: { outputPath?: string } }[]
  expect(items[1]?.detail.outputPath).toBe(OUT)
})

test('the poll records new lines with the time received and ends on the exit line', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const held: Record<string, string> = {}
  files(on, held)
  tools(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await arm($)
  held[OUT] = 'build queued\n'
  await clock.advance(2000)
  held[OUT] += 'build success\n'
  await clock.advance(2000)
  expect(state['rabe.lines']?.value).toMatchObject({
    'monitor:m1': {
      seen: 2,
      lines: [
        { at: 3000, text: 'build queued' },
        { at: 5000, text: 'build success' },
      ],
    },
  })
  held[OUT] += 'e2e failed\n\n[exited with code 1]\n'
  await clock.advance(2000)
  const items = state['rabe.items']?.value as { status: string; endedAt?: number }[]
  expect(items[1]).toMatchObject({ status: 'failed', endedAt: 7000 })
  expect(state['rabe.lines']?.value).toMatchObject({ 'monitor:m1': { seen: 3 } })
})

test('a task notification ends the monitor and reads its last lines', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  files(on, { [OUT]: 'tick 1\ntick 2\n\n[exited with code 0]\n' })
  tools(on)
  core(on)
  await arm($)
  await clock.set(4000)
  await $.prompt.submit({
    text: `<task-notification>
<task-id>m1</task-id>
<output-file>${OUT}</output-file>
<status>completed</status>
<summary>Monitor "CI run 482" stream ended</summary>
</task-notification>`,
    origin: { kind: 'task-notification' },
    wait: false,
  })
  expect(state['rabe.items']?.value).toEqual([
    {
      ...watching,
      status: 'done',
      endedAt: 4000,
      detail: { ...watching.detail, outputPath: OUT },
    },
  ])
  expect(state['rabe.lines']?.value).toMatchObject({
    'monitor:m1': {
      seen: 2,
      lines: [
        { at: 4000, text: 'tick 1' },
        { at: 4000, text: 'tick 2' },
      ],
    },
  })
})

test('an event notification without a status ends nothing', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await arm($)
  await $.prompt.submit({
    text: '<task-notification>\n<task-id>m1</task-id>\n<event>tick 1</event>\n</task-notification>',
    origin: { kind: 'task-notification' },
    wait: false,
  })
  expect(state['rabe.items']?.value).toEqual([watching])
})

// The end notification of a subagent's monitor reaches only the subagent.
test('a subagent monitor ends from the exit line of its output file; the main Stop leaves it running', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const held: Record<string, string> = { [OUT]: 'tick 1\n' }
  files(on, held)
  tools(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await $.tool.call({
    tool: 'Monitor',
    description: 'CI run 482',
    command: 'gh run watch 482 --exit-status',
    timeout_ms: 1_800_000,
    agentId: 'a1',
  } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  const monitor = () =>
    (
      (state['rabe.items']?.value ?? []) as { id: string; status: string; parentId?: string }[]
    ).find(one => one.id === 'monitor:m1')
  expect(monitor()).toMatchObject({ status: 'running', parentId: 'agent:a1' })
  held[OUT] += '\n[exited with code 0]\n'
  await clock.advance(2000)
  expect(monitor()).toMatchObject({ status: 'done', endedAt: 3000 })
})

test('at Stop a monitor no longer in flight ends; one Rabe never saw is added', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await arm($)
  await clock.set(3000)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'm0', type: 'monitor', status: 'running', description: 'deploy log' }],
  })
  expect(state['rabe.items']?.value).toEqual([
    { ...watching, status: 'stopped', endedAt: 3000 },
    {
      id: 'monitor:m0',
      kind: 'monitor',
      title: 'deploy log',
      status: 'running',
      seenAt: 3000,
      detail: { command: 'deploy log', description: 'deploy log', taskId: 'm0' },
    },
  ])
})

for (const path of [
  '/etc/secrets',
  `${DIR}-other/m1.output`,
  `${DIR}/../../secret.output`,
  `${DIR}/m1.output/../secret.output`,
  `${DIR.replace('5f1c', 'other-session')}/m1.output`,
  `${DIR}/linked.output`,
  `${DIR.replace('-home-me-app', '-other-project')}/m1.output`,
]) {
  test(`monitor output outside the task folder is never read: ${path}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    const reads: string[] = []
    on('fs.stat', async (_$, e) => ({
      value: {
        kind: 'file' as const,
        size: 5,
        mtimeMs: 0,
        isLink: path.endsWith('linked.output'),
        realPath: e.path === path && path.endsWith('linked.output') ? '/etc/secrets' : e.path,
      },
    }))
    on('fs.read', async (_$, e) => {
      reads.push(e.path)
      return { value: 'secret\n' }
    })
    tools(on)
    core(on)
    state['rabe.items'] = {
      value: [{ ...watching, detail: { ...watching.detail, outputPath: path } }],
      version: 1,
    }
    await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
    await clock.advance(2000)
    await $.prompt.submit({
      text: `<task-notification><task-id>m1</task-id><output-file>${path}</output-file><status>completed</status></task-notification>`,
      origin: { kind: 'task-notification' },
      wait: false,
    })
    expect(reads).not.toContain(path)
    expect(state['rabe.lines']?.value).toBeUndefined()
  })
}

test('monitor cursors skip idle output, repair UTF-8 partial lines and detect replacement', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const held = { [OUT]: 'réad\npar' }
  const reads: string[] = []
  const tails: string[][] = []
  let inode = 1
  on('fs.read', async (_$, e, next) => {
    reads.push(e.path)
    return next(e)
  })
  on(
    'process.run',
    { argv: 'ls' },
    async () => ({ value: { exitCode: 0, stdout: `${inode} file\n`, stderr: '' } }) as never,
  )
  on('process.run', { argv: 'tail' }, async (_$, e, next) => {
    tails.push([...e.argv])
    return next(e)
  })
  files(on, held)
  tools(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'sleep 10', run_in_background: true })
  await arm($)
  await clock.advance(2000)

  expect(state['rabe.diag']?.value).toMatchObject({
    monitors: { files: 1, chars: 8, bytes: 9, skipped: 0, errors: 0 },
  })
  const versions = Object.fromEntries(
    Object.entries(state)
      .filter(([key]) => key !== 'rabe.diag')
      .map(([key, value]) => [key, value.version]),
  )
  reads.length = 0
  await clock.advance(2000)
  expect(reads).toEqual([])
  expect(state['rabe.diag']?.value).toMatchObject({
    monitors: { files: 0, bytes: 0, skipped: 1, errors: 0 },
  })
  expect(
    Object.fromEntries(
      Object.entries(state)
        .filter(([key]) => key !== 'rabe.diag')
        .map(([key, value]) => [key, value.version]),
    ),
  ).toEqual(versions)
  held[OUT] += 'tial\n'
  await clock.advance(2000)
  expect(tails).toEqual([['tail', '-c', '+7', '--', OUT]])
  expect(state['rabe.diag']?.value).toMatchObject({
    monitors: { files: 1, bytes: 8, skipped: 0, errors: 0 },
  })
  expect(state['rabe.lines']?.value).toMatchObject({
    'monitor:m1': {
      seen: 2,
      lines: [
        { at: 3000, text: 'réad' },
        { at: 3000, text: 'partial' },
      ],
    },
  })
  // A changed stat triggers the inode check before reading the replacement.
  held[OUT] = 'new file lines\n'
  inode++
  await clock.advance(2000)
  expect(state['rabe.lines']?.value).toMatchObject({
    'monitor:m1': { seen: 1, lines: [{ at: 9000, text: 'new file lines' }] },
  })
})

test('a shrinking output resets its lines and byte cursor', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const path = OUT
  const held = { [path]: 'old history\n' }
  const log: string[] = []
  files(on, held, log)
  tools(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'build', run_in_background: true })
  await arm($)
  await clock.advance(2000)
  log.length = 0
  held[path] = 'new\n'
  await clock.advance(2000)
  expect(log).toEqual([`read ${path}`])
  expect(state['rabe.lines']?.value).toMatchObject({
    'monitor:m1': { seen: 1, lines: [{ at: 5000, text: 'new' }], cursor: { offset: 4 } },
  })
})

test('output and cursor commit together after a competing state write', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let reject = false
  let retries = 0
  on('state.set', { plugin: 'rabe' }, async (_$, e, next) => {
    if (
      reject &&
      e.key === 'lines' &&
      (e.value as Record<string, { cursor?: unknown }>)['monitor:m1']?.cursor
    ) {
      reject = false
      retries++
      const entry = state['rabe.lines']
      if (entry)
        state['rabe.lines'] = {
          value: { ...(entry.value as object), other: { seen: 0, lines: [] } },
          version: entry.version + 1,
        }
      return { value: { isSet: false, version: (e.ifVersion ?? 0) + 1 } } as never
    }
    return next(e)
  })
  const state = memoryState(on)
  const path = OUT
  const held = { [path]: 'one\n' }
  const log: string[] = []
  files(on, held, log)
  tools(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'build', run_in_background: true })
  await arm($)
  await clock.advance(2000)
  held[path] += 'two\n'
  reject = true
  await clock.advance(2000)
  log.length = 0
  await clock.advance(2000)
  expect(retries).toBe(1)
  expect(log).toEqual([])
  expect(state['rabe.lines']?.value).toMatchObject({
    other: { seen: 0, lines: [] },
    'monitor:m1': {
      seen: 2,
      lines: [
        { at: 3000, text: 'one' },
        { at: 5000, text: 'two' },
      ],
      cursor: { offset: 8 },
    },
  })
})

test('a discarded monitor pass replays the exit result from an unchanged file', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let restart = true
  on('state.set', { key: 'lines' }, async (_$, e, next) => {
    const result = await next(e)
    if (restart) {
      restart = false
      await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
    }
    return result
  })
  const state = memoryState(on)
  tools(on)
  core(on)
  const log: string[] = []
  files(on, { [OUT]: 'ready\n\n[exited with code 0]\n' }, log)
  state['rabe.items'] = {
    value: [{ ...watching, detail: { ...watching.detail, outputPath: OUT } }],
    version: 1,
  }
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.status).toBe('running')
  expect(restart).toBe(false)
  log.length = 0
  await clock.advance(2000)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.status).toBe('done')
  expect(log).toEqual([])
})

for (const rotation of ['truncation', 'inode replacement']) {
  test(`a monitor resets discard mode after ${rotation}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    tools(on)
    core(on)
    const path = OUT
    files(on, { [path]: 'fresh\n\n[exited with code 0]\n' })
    state['rabe.items'] = {
      value: [{ ...watching, detail: { ...watching.detail, outputPath: OUT } }],
      version: 1,
    }
    state['rabe.lines'] = {
      value: {
        'monitor:m1': {
          seen: 0,
          lines: [],
          cursor: {
            size: rotation === 'truncation' ? 100 : 1,
            offset: 1,
            mtimeMs: 1,
            identity: `${path}:old`,
            partial: false,
            isDiscarding: true,
          },
        },
      },
      version: 1,
    }
    await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
    await clock.advance(2000)
    expect(state['rabe.lines']?.value).toMatchObject({
      'monitor:m1': { seen: 1, lines: [{ text: 'fresh' }] },
    })
  })
}

for (const broken of [
  null,
  { cursor: { identity: 42 }, lines: null },
  { seen: 0, lines: [], cursor: { size: 6, offset: 'bad', mtimeMs: 0, partial: false } },
]) {
  test(`a monitor rebuilds malformed restored output ${JSON.stringify(broken)}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    tools(on)
    core(on)
    files(on, { [OUT]: 'fresh\n' })
    state['rabe.items'] = {
      value: [{ ...watching, detail: { ...watching.detail, outputPath: OUT } }],
      version: 1,
    }
    state['rabe.lines'] = { value: broken === null ? null : { 'monitor:m1': broken }, version: 1 }
    await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
    await clock.advance(2000)
    expect(state['rabe.lines']?.value).toMatchObject({
      'monitor:m1': { seen: 1, lines: [{ text: 'fresh' }] },
    })
  })
}

test('the task list replays a cached monitor exit after a discarded item write', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let reject = true
  on('state.set', { key: 'items' }, async (_$, e, next) => {
    if (reject) {
      reject = false
      return { deny: 'item write failed' }
    }
    return next(e)
  })
  const state = memoryState(on)
  tools(on)
  core(on)
  files(on, { [OUT]: 'ready\n\n[exited with code 0]\n' })
  state['rabe.items'] = {
    value: [{ ...watching, detail: { ...watching.detail, outputPath: OUT } }],
    version: 1,
  }
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.status).toBe('running')
  await $.classic.Stop({
    session_id: '5f1c',
    stop_hook_active: false,
    background_tasks: [],
  } as never)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.status).toBe('done')
})

test('an item a hook write pushes out loses its diffs, though it has no turns', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const held = overCap(MAX_ENDED)
  tools(on)
  core(on)
  state['rabe.items'] = { value: held.items, version: 1 }
  state['rabe.diffs'] = { value: held.diffs, version: 1 }
  await arm($)
  expect(state['rabe.diffs']?.value).toEqual({ 'shell:old1': held.diffs['shell:old1'] })
})
