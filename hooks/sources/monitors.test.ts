import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { core, files, memoryState } from '../testing'

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
  expect(state['rabe.lines']?.value).toEqual({
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
  expect(state['rabe.lines']?.value).toEqual({
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
  const versions = Object.fromEntries(
    Object.entries(state).map(([key, value]) => [key, value.version]),
  )
  reads.length = 0
  await clock.advance(2000)
  expect(reads).toEqual([])
  expect(
    Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.version])),
  ).toEqual(versions)
  held[OUT] += 'tial\n'
  await clock.advance(2000)
  expect(tails).toEqual([['tail', '-c', '+7', '--', OUT]])
  expect(state['rabe.lines']?.value).toMatchObject({
    'monitor:m1': {
      seen: 2,
      lines: [
        { at: 3000, text: 'réad' },
        { at: 3000, text: 'partial' },
      ],
    },
  })
  // Same size and mtime as the file the cursor just consumed.
  held[OUT] = 'new file line\n'
  inode++
  await clock.advance(2000)
  expect(state['rabe.lines']?.value).toMatchObject({
    'monitor:m1': { seen: 1, lines: [{ at: 9000, text: 'new file line' }] },
  })
})
