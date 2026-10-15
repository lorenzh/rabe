import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { RabeItem } from '../model'
import { MAX_ENDED, MAX_FOREGROUND } from '../registry'
import { core, files, memoryState } from '../testing'

const DIR = '/tmp/claude-1000/-home-me-app/5f1c/tasks'

function bash(on: On) {
  on('session.id', async () => ({ value: '5f1c' }))
  on('session.root', async () => ({ value: '/home/me/app' }))
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    const taskId =
      e.tool === 'Bash' && e.run_in_background
        ? e.description === 'Starting the API dev server'
          ? 'b1'
          : (e.description ?? 'b1')
        : undefined

    return {
      result: {
        stdout: '',
        stderr: '',
        interrupted: false,
        ...(taskId && { backgroundTaskId: taskId }),
      },
      text: taskId
        ? `Command running in background with ID: ${taskId}. Output is being written to: ${DIR}/${taskId}.output. If it exits you will be notified.`
        : 'ok',
    }
  })
}

const running = {
  id: 'shell:b1',
  kind: 'shell',
  title: 'bun run dev · b1',
  status: 'running',
  seenAt: 1000,
  startedAt: 1000,
  detail: { command: 'bun run dev', taskId: 'b1', outputPath: `${DIR}/b1.output` },
}

test('a background Bash call adds a running shell with its output file', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  expect(state['rabe.items']?.value).toEqual([running])
})

test('a background Bash row uses its description and keeps the original command', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({
    tool: 'Bash',
    command: 'while true; do\n  echo ready; done',
    description: 'Starting the API dev server',
    run_in_background: true,
  })
  expect((state['rabe.items']?.value as RabeItem[] | undefined)?.[0]).toMatchObject({
    title: 'Starting the API dev server · b1',
    detail: { command: 'while true; do\n  echo ready; done' },
  })
})

test('a quick foreground Bash call adds an ended row and never a running one', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' })
  expect(state['rabe.items']?.value).toMatchObject([
    {
      kind: 'shell',
      status: 'done',
      title: 'List files · foreground',
      startedAt: 1000,
      endedAt: 1000,
      detail: { command: 'ls' },
    },
  ])
  // One write: the row never showed as running.
  expect(state['rabe.items']?.version).toBe(1)
})

// A Bash call that holds until `release()`; its result is `result`.
function slowBash(on: On, result: Record<string, unknown> = {}) {
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    await held
    return { result: { stdout: '', stderr: '', interrupted: false, ...result }, text: 'ok' }
  })

  return release
}

test('a foreground Bash call that runs on shows as a running shell and ends when it returns', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const release = slowBash(on)
  core(on)
  const call = $.tool.call({
    tool: 'Bash',
    command: 'timeout 25m gh pr checks 7 --watch',
    description: 'Watch the checks',
  })
  await clock.advance(3000)
  expect(state['rabe.items']?.value).toMatchObject([
    {
      kind: 'shell',
      status: 'running',
      title: expect.stringContaining('Watch the checks'),
      startedAt: 1000,
      detail: { command: 'timeout 25m gh pr checks 7 --watch' },
    },
  ])
  await clock.advance(1000)
  release()
  await call
  expect(state['rabe.items']?.value).toMatchObject([
    { status: 'done', startedAt: 1000, endedAt: 5000 },
  ])
  expect(state['rabe.items']?.value).toHaveLength(1)
})

test('a foreground call that fails after its row showed ends as stopped', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  let fail = (_: Error) => {}
  const held = new Promise<never>((_, reject) => {
    fail = reject
  })
  on('tool.call', { tool: 'Bash' }, async () => held)
  core(on)
  const call = $.tool.call({ tool: 'Bash', command: 'sleep 900' })
  const settled = call.then(
    () => 'ok',
    () => 'rejected',
  )
  await clock.advance(3000)
  expect(state['rabe.items']?.value).toMatchObject([{ kind: 'shell', status: 'running' }])
  fail(new Error('interrupted'))
  expect(await settled).toBe('rejected')
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'stopped', endedAt: 4000 }])
})

test('a quick foreground call that is rejected adds a stopped row', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    throw new Error('aborted')
  })
  core(on)
  await expect($.tool.call({ tool: 'Bash', command: 'ls' })).rejects.toThrow()
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'stopped', endedAt: 1000 }])
})

// A Bash call answered with `answer` right away.
function answering(on: On, answer: Record<string, unknown>) {
  on('tool.call', { tool: 'Bash' }, async () => answer as never)
}

test('a foreground call that answers with an error ends as failed', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  answering(on, { result: { error: 'exit 1' }, isError: true })
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'false' })
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'failed', endedAt: 1000 }])
})

test('a refused or interrupted foreground call ends as stopped', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  let answer: Record<string, unknown> = { deny: 'User rejected the command' }
  on('tool.call', { tool: 'Bash' }, async () => answer as never)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/x' })
  answer = { result: { stdout: '', stderr: '', interrupted: true }, text: 'ok' }
  await $.tool.call({ tool: 'Bash', command: 'sleep 9' })
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'stopped' }, { status: 'stopped' }])
})

test('a foreground call in a subagent keeps its ended row under the agent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'done', parentId: 'agent:a1' }])
})

test('ended foreground rows have their own cap and leave other ended items alone', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const agent = { id: 'agent:a1', kind: 'agent', title: 'a', status: 'done', seenAt: 1, endedAt: 1 }
  state['rabe.items'] = { value: [agent], version: 1 }
  bash(on)
  core(on)
  for (let i = 0; i < MAX_FOREGROUND + 5; i++) {
    await clock.set(1000 + i)
    await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
  }
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items[0]).toEqual(agent)
  expect(items.filter(item => item.id.startsWith('shell:fg-'))).toHaveLength(MAX_FOREGROUND)
  expect(items[1]?.detail).toMatchObject({ command: 'echo 5' })
})

test('a refused detached codex exec leaves no running row', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  let answer: Record<string, unknown> = { deny: 'User rejected the command' }
  on('tool.call', { tool: 'Bash' }, async () => answer as never)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'nohup codex exec -o /tmp/result.txt x &' })
  answer = { result: { error: 'rejected' }, isError: true }
  await $.tool.call({ tool: 'Bash', command: 'nohup codex exec -o /tmp/result.txt x &' })
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'stopped' }, { status: 'failed' }])
})

test('a foreground call that Claude Code moved to the background leaves only the background row', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const release = slowBash(on, { backgroundTaskId: 'b9' })
  core(on)
  const call = $.tool.call({ tool: 'Bash', command: 'sleep 900' })
  await clock.advance(3000)
  release()
  await call
  expect(state['rabe.items']?.value).toMatchObject([{ id: 'shell:b9', startedAt: 1000 }])
})

test('at Stop a foreground row without a task id is left running', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const release = slowBash(on)
  core(on)
  const call = $.tool.call({ tool: 'Bash', command: 'codex exec -o /tmp/r.txt - < /tmp/b.md' })
  await clock.advance(3000)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'running' }])
  release()
  await call
})

test('a detached codex exec stays running until its result file appears', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  let mtimeMs: number | undefined
  on('fs.stat', async (_$, e, next) =>
    e.path === '/tmp/r.txt' && mtimeMs !== undefined
      ? { value: { kind: 'file' as const, size: 4, mtimeMs, isLink: false } }
      : next(e),
  )
  on('tool.call', { tool: 'Bash' }, async () => ({
    result: { stdout: '', stderr: '', interrupted: false },
    text: 'ok',
  }))
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'Bash',
    command: 'nohup codex exec -m gpt-5.5 -o /tmp/r.txt - < /tmp/b.md > /tmp/l 2>&1 &',
  })
  await clock.advance(2000)
  expect(state['rabe.items']?.value).toMatchObject([
    { status: 'running', detail: { resultPath: '/tmp/r.txt' } },
  ])
  mtimeMs = 500
  await clock.advance(2000)
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'running' }])
  mtimeMs = 5000
  await clock.advance(2000)
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'done', endedAt: 7000 }])
})

test('a background Bash call in a subagent names the agent as parent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({
    tool: 'Bash',
    command: 'bun run dev',
    run_in_background: true,
    agentId: 'a1',
  } as never)
  expect(state['rabe.items']?.value).toEqual([{ ...running, parentId: 'agent:a1' }])
})

test('a task notification ends the shell with its exit code', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await clock.set(5000)
  await $.prompt.submit({
    text: `<task-notification>
<task-id>b1</task-id>
<output-file>${DIR}/b1.output</output-file>
<status>failed</status>
<summary>Background command "Start dev server" failed with exit code 2</summary>
</task-notification>`,
    origin: { kind: 'task-notification' },
    wait: false,
  })
  expect(state['rabe.items']?.value).toEqual([
    { ...running, status: 'failed', endedAt: 5000, detail: { ...running.detail, exitCode: 2 } },
  ])
})

test('the same text typed by the user ends nothing', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await $.prompt.submit({
    text: '<task-notification><task-id>b1</task-id><status>killed</status></task-notification>',
    origin: { kind: 'composer' },
    wait: false,
  })
  expect(state['rabe.items']?.value).toEqual([running])
})

test('the poll reads the port, when it found it, and the exit line from the output file', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const held: Record<string, string> = {}
  files(on, held)
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  held[`${DIR}/b1.output`] = '  ➜  Local:   http://localhost:5173/\n'
  await clock.advance(2000)
  expect(state['rabe.items']?.value).toEqual([
    { ...running, detail: { ...running.detail, port: 5173, portAt: 3000 } },
  ])
  held[`${DIR}/b1.output`] += '\n[exited with code 0]\n'
  await clock.advance(2000)
  expect(state['rabe.items']?.value).toEqual([
    {
      ...running,
      status: 'done',
      endedAt: 5000,
      detail: { ...running.detail, port: 5173, portAt: 3000, exitCode: 0 },
    },
  ])
})

test('at Stop a shell no longer in flight ends by its exit line, else as stopped', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const held: Record<string, string> = { [`${DIR}/b1.output`]: 'boom\n\n[exited with code 1]\n' }
  files(on, held)
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await $.tool.call({
    tool: 'Bash',
    command: 'sleep 99',
    description: 'b2',
    run_in_background: true,
  })
  await clock.set(3000)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  const ended = state['rabe.items']?.value as {
    status: string
    detail: { exitCode?: number }
  }[]
  expect(ended.map(one => [one.status, one.detail.exitCode])).toEqual([
    ['failed', 1],
    ['stopped', undefined],
  ])
})

// The end notification of a subagent's shell reaches only the subagent.
test('a subagent shell ends from the exit line of its output file; the main Stop leaves it running', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const held: Record<string, string> = { [`${DIR}/b1.output`]: 'ready\n' }
  files(on, held)
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'Bash',
    command: 'bun run dev',
    run_in_background: true,
    agentId: 'a1',
  } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await clock.advance(2000)
  expect(state['rabe.items']?.value).toEqual([{ ...running, parentId: 'agent:a1' }])
  held[`${DIR}/b1.output`] += '\n[exited with code 0]\n'
  await clock.advance(2000)
  expect(state['rabe.items']?.value).toEqual([
    {
      ...running,
      parentId: 'agent:a1',
      status: 'done',
      endedAt: 5000,
      detail: { ...running.detail, exitCode: 0 },
    },
  ])
})

test('at Stop a shell started before Rabe loaded is added', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b1', type: 'shell', status: 'running', description: 'dev', command: 'bun run dev' },
      { id: 'b0', type: 'shell', status: 'running', description: 'watch', command: 'tsc -w' },
      { id: 'a1', type: 'subagent', status: 'running', description: 'review' },
    ],
  })
  expect(state['rabe.items']?.value).toEqual([
    running,
    {
      id: 'shell:b0',
      kind: 'shell',
      title: 'watch · b0',
      status: 'running',
      seenAt: 1000,
      detail: { command: 'tsc -w', taskId: 'b0', outputPath: `${DIR}/b0.output` },
    },
  ])
})

test('at Stop a monitor, which Claude Code lists as a shell, is not added as a shell', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const monitor = {
    id: 'monitor:m1',
    kind: 'monitor',
    title: 'CI run',
    status: 'running',
    seenAt: 500,
    detail: { command: 'gh run watch 1', taskId: 'm1' },
  }
  state['rabe.items'] = { value: [monitor], version: 1 }
  core(on)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      {
        id: 'm1',
        type: 'shell',
        status: 'running',
        description: 'CI run',
        command: 'gh run watch 1',
      },
    ],
  })
  expect(state['rabe.items']?.value).toEqual([monitor])
})

test('the poll keeps the output lines in rabe.lines; an end that pushes a shell out drops its lines', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const held: Record<string, string> = {}
  files(on, held)
  const state = memoryState(on)
  const old = Array.from({ length: MAX_ENDED }, (_, n) => ({
    ...running,
    id: `shell:old${n}`,
    status: 'done',
    seenAt: 10 + n,
    endedAt: 10 + n,
  }))
  state['rabe.items'] = { value: old, version: 1 }
  const gone = { seen: 1, lines: [] }
  state['rabe.lines'] = { value: { 'shell:old0': gone, 'shell:old1': gone }, version: 1 }
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  held[`${DIR}/b1.output`] = 'ready\n'
  await clock.advance(2000)
  held[`${DIR}/b1.output`] += 'boom\n\n[exited with code 1]\n'
  // The poll's timer ends b1, so the cap pushes out the oldest ended shell.
  await clock.advance(2000)
  expect(Object.keys(state['rabe.lines']?.value as object)).toEqual(['shell:old1', 'shell:b1'])
  expect(state['rabe.lines']?.value).toMatchObject({
    'shell:old1': gone,
    'shell:b1': {
      seen: 2,
      lines: [
        { at: 3000, text: 'ready' },
        { at: 5000, text: 'boom' },
      ],
    },
  })
})

test('a task notification keeps the last lines of a shell the poll did not read', async ($, on) => {
  mock.clock(on, { now: 1000 })
  files(on, { [`${DIR}/b1.output`]: 'done fast\n\n[exited with code 0]\n' })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await $.prompt.submit({
    text: `<task-notification><task-id>b1</task-id><output-file>${DIR}/b1.output</output-file><status>completed</status></task-notification>`,
    origin: { kind: 'task-notification' },
    wait: false,
  })
  expect(state['rabe.lines']?.value).toMatchObject({
    'shell:b1': { seen: 1, lines: [{ at: 1000, text: 'done fast' }] },
  })
})

test('an output file over 4 MiB is read with tail, its path after --', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const path = `${DIR}/b1.output`
  on('fs.stat', async (_$, e, next) =>
    e.path === path || e.path === DIR
      ? {
          value: {
            kind: e.path === DIR ? ('dir' as const) : ('file' as const),
            size: 5 * 1024 * 1024,
            mtimeMs: 0,
            isLink: false,
            realPath: e.path,
          },
        }
      : next(e),
  )
  const runs: string[][] = []
  const timeouts: (number | undefined)[] = []
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    timeouts.push(e.init?.timeoutMs)
    return {
      value: { exitCode: 0, stdout: e.argv[0] === 'ls' ? '1 file\n' : 'port 4000\n', stderr: '' },
    } as never
  })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await clock.advance(2000)
  expect(runs).toContainEqual(['tail', '-c', '+1', '--', path])
  expect(timeouts.every(ms => ms !== undefined && ms <= 5000)).toBe(true)
  expect((state['rabe.items']?.value as RabeItem[] | undefined)?.[0]).toMatchObject({
    detail: { port: 4000 },
  })
})

for (const path of [
  '/etc/secrets',
  `${DIR}-other/b1.output`,
  `${DIR}/../../secret.output`,
  `${DIR}/b1.output/../secret.output`,
  `${DIR.replace('5f1c', 'other-session')}/b1.output`,
  `${DIR}/linked.output`,
  `${DIR.replace('-home-me-app', '-other-project')}/b1.output`,
]) {
  test(`shell output outside the task folder is never read: ${path}`, async ($, on) => {
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
    bash(on)
    core(on)
    state['rabe.items'] = {
      value: [{ ...running, detail: { ...running.detail, outputPath: path } }],
      version: 1,
    }
    await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
    await clock.advance(2000)
    await $.prompt.submit({
      text: `<task-notification><task-id>b1</task-id><output-file>${path}</output-file><status>completed</status></task-notification>`,
      origin: { kind: 'task-notification' },
      wait: false,
    })
    expect(reads).not.toContain(path)
    expect(state['rabe.lines']?.value).toBeUndefined()
  })
}

test('an unchanged output reads nothing and an append reads only the new bytes', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const path = `${DIR}/b1.output`
  const held = { [path]: 'ready\n' }
  const log: string[] = []
  let spawns = 0
  on('process.run', { argv: 'ls' }, async (_$, e, next) => {
    spawns++
    return next(e)
  })
  files(on, held, log)
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await clock.advance(2000)
  expect(log).toEqual([`read ${path}`])
  expect(state['rabe.diag']?.value).toMatchObject({
    shells: { files: 1, bytes: 6, skipped: 0, errors: 0 },
  })
  log.length = 0
  const first = state['rabe.lines']
  await clock.advance(2000)
  expect(log).toEqual([])
  expect(state['rabe.diag']?.value).toMatchObject({
    shells: { files: 0, bytes: 0, skipped: 1, errors: 0 },
  })
  expect(spawns).toBe(1)
  expect(state['rabe.lines']).toBe(first)
  held[path] += 'more\n'
  await clock.advance(2000)
  expect(log).toEqual([`tail +7 ${path}`])
  expect(state['rabe.diag']?.value).toMatchObject({
    shells: { files: 1, bytes: 5, skipped: 0, errors: 0 },
  })
  expect(state['rabe.lines']?.value).toMatchObject({
    'shell:b1': {
      seen: 2,
      lines: [
        { at: 3000, text: 'ready' },
        { at: 7000, text: 'more' },
      ],
    },
  })
})

test('an ended shell finishes reading its backlog without changing its end time', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const path = `${DIR}/b1.output`
  const offset = 4 * 1024 * 1024
  on('fs.stat', async (_$, e) => ({
    value: {
      kind: e.path === DIR ? 'dir' : 'file',
      size: offset + 9,
      mtimeMs: 1,
      realPath: e.path,
      isLink: false,
    },
  }))
  let spawns = 0
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'ls') spawns++
    return {
      value: {
        exitCode: 0,
        stdout: e.argv[0] === 'ls' ? '1 file\n' : '[killed]\n',
        stderr: '',
        isStdoutTruncated: false,
      },
    } as never
  })
  state['rabe.items'] = { value: [{ ...running, status: 'stopped', endedAt: 500 }], version: 1 }
  state['rabe.lines'] = {
    value: {
      'shell:b1': {
        seen: 0,
        lines: [],
        cursor: { size: offset + 9, mtimeMs: 1, identity: `${path}:1`, offset, partial: false },
      },
    },
    version: 1,
  }
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  expect(
    ((state['rabe.lines']?.value ?? {}) as Record<string, { cursor: { offset: number } }>)[
      'shell:b1'
    ]?.cursor.offset,
  ).toBe(offset + 9)
  expect(spawns).toBe(0)
  expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.endedAt).toBe(500)
})

test('small output still follows when inode lookup is unavailable', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const path = `${DIR}/b1.output`
  const held = { [path]: 'ready\n' }
  on('process.run', { argv: 'ls' }, async () => ({ deny: 'No process host' }))
  files(on, held)
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'build', run_in_background: true })
  await clock.advance(2000)
  const first = state['rabe.lines']
  await clock.advance(2000)
  expect(state['rabe.lines']).toBe(first)
  held[path] += 'done\n\n[exited with code 0]\n'
  await clock.advance(2000)
  expect(state['rabe.lines']?.value).toMatchObject({
    'shell:b1': {
      seen: 2,
      lines: [
        { at: 3000, text: 'ready' },
        { at: 7000, text: 'done' },
      ],
    },
  })
})

test('without an inode lookup an unchanged output is skipped and raises no error', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const path = `${DIR}/b1.output`
  const held = { [path]: 'ready\n' }
  const log: string[] = []
  on('process.run', { argv: 'ls' }, async () => ({ deny: 'No process host' }))
  files(on, held, log)
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'build', run_in_background: true })
  await clock.advance(2000)
  expect(state['rabe.diag']?.value).toMatchObject({
    shells: { files: 1, skipped: 0, errors: 0 },
  })
  log.length = 0
  await clock.advance(2000)
  expect(log).toEqual([])
  expect(state['rabe.diag']?.value).toMatchObject({
    shells: { files: 0, skipped: 1, errors: 0 },
  })
})

test('a shrinking output resets its lines and byte cursor', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const path = `${DIR}/b1.output`
  const held = { [path]: 'old history\n' }
  const log: string[] = []
  files(on, held, log)
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'build', run_in_background: true })
  await clock.advance(2000)
  log.length = 0
  held[path] = 'new\n'
  await clock.advance(2000)
  expect(log).toEqual([`read ${path}`])
  expect(state['rabe.lines']?.value).toMatchObject({
    'shell:b1': { seen: 1, lines: [{ at: 5000, text: 'new' }], cursor: { offset: 4 } },
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
      (e.value as Record<string, { cursor?: unknown }>)['shell:b1']?.cursor
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
  const path = `${DIR}/b1.output`
  const held = { [path]: 'one\n' }
  const log: string[] = []
  files(on, held, log)
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'build', run_in_background: true })
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
    'shell:b1': {
      seen: 2,
      lines: [
        { at: 3000, text: 'one' },
        { at: 5000, text: 'two' },
      ],
      cursor: { offset: 8 },
    },
  })
})

test('a discarded shell pass replays the exit result from an unchanged file', async ($, on) => {
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
  bash(on)
  core(on)
  const log: string[] = []
  files(on, { [`${DIR}/b1.output`]: 'ready\n\n[exited with code 0]\n' }, log)
  state['rabe.items'] = { value: [running], version: 1 }
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
  test(`a shell resets discard mode after ${rotation}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    bash(on)
    core(on)
    const path = `${DIR}/b1.output`
    files(on, { [path]: 'fresh\n\n[exited with code 0]\n' })
    state['rabe.items'] = { value: [running], version: 1 }
    state['rabe.lines'] = {
      value: {
        'shell:b1': {
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
      'shell:b1': { seen: 1, lines: [{ text: 'fresh' }] },
    })
  })
}

for (const broken of [
  null,
  { cursor: { identity: 42 }, lines: null },
  { seen: 0, lines: [], cursor: { size: 6, offset: 'bad', mtimeMs: 0, partial: false } },
]) {
  test(`a shell rebuilds malformed restored output ${JSON.stringify(broken)}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    bash(on)
    core(on)
    files(on, { [`${DIR}/b1.output`]: 'fresh\n' })
    state['rabe.items'] = { value: [running], version: 1 }
    state['rabe.lines'] = { value: broken === null ? null : { 'shell:b1': broken }, version: 1 }
    await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
    await clock.advance(2000)
    expect(state['rabe.lines']?.value).toMatchObject({
      'shell:b1': { seen: 1, lines: [{ text: 'fresh' }] },
    })
  })
}

test('the task list replays a cached shell exit after a discarded item write', async ($, on) => {
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
  bash(on)
  core(on)
  files(on, { [`${DIR}/b1.output`]: 'ready\n\n[exited with code 0]\n' })
  state['rabe.items'] = { value: [running], version: 1 }
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

for (const mode of [
  'silent',
  'redirected',
  'no holder',
  'shared socket',
  'stderr',
  'missing tool',
  'truncated',
  'failed command',
  'output port',
  'non-linux',
  'ended',
  'unsafe path',
]) {
  test(`listening ports of a shell: ${mode}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    const path = `${DIR}/b1.output`
    files(on, {
      [path]:
        mode === 'redirected'
          ? 'output goes elsewhere\n'
          : mode === 'output port'
            ? 'port 5173\n'
            : '',
    })
    const calls: string[][] = []
    on('process.run', { argv: ['uname', 'fuser', 'ps', 'ss'] }, async (_$, e) => {
      calls.push([...e.argv])
      expect(e.init?.timeoutMs).toBe(5000)
      if (mode === 'missing tool') return { deny: 'not found' }
      const stdout =
        e.argv[0] === 'uname'
          ? mode === 'non-linux'
            ? 'Darwin'
            : 'Linux'
          : e.argv[0] === 'fuser'
            ? mode === 'no holder'
              ? ''
              : '100'
            : e.argv[0] === 'ps'
              ? '102 101\n101 100\n100 1\n999 1\n'
              : `LISTEN 0 128 [::]:8090 [::]:* users:(("python3",pid=102,fd=3)${mode === 'shared socket' ? ',("claude",pid=999,fd=4)' : ''})\n`
      return {
        value: {
          exitCode:
            (mode === 'failed command' && e.argv[0] === 'ss') ||
            (mode === 'no holder' && e.argv[0] === 'fuser')
              ? 1
              : 0,
          stdout,
          stderr:
            mode === 'stderr' && e.argv[0] === 'ss'
              ? 'Cannot open netlink socket'
              : e.argv[0] === 'fuser' && mode !== 'no holder'
                ? `${path}:`
                : '',
          isStdoutTruncated: mode === 'truncated' && e.argv[0] === 'ss',
        },
      } as never
    })
    bash(on)
    core(on)
    state['rabe.items'] = {
      value: [
        {
          ...running,
          status: mode === 'ended' ? 'done' : 'running',
          detail: {
            ...running.detail,
            outputPath: mode === 'unsafe path' ? '/etc/private.output' : path,
          },
        },
      ],
      version: 1,
    }
    await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
    await clock.advance(2000)
    const found = mode === 'silent' || mode === 'redirected'
    const item = ((state['rabe.items']?.value ?? []) as RabeItem[])[0]
    expect(item?.kind === 'shell' ? item.detail.port : undefined).toBe(
      found ? 8090 : mode === 'output port' ? 5173 : undefined,
    )
    if (mode === 'no holder') {
      expect(calls).toContainEqual(['fuser', path])
      expect(state['rabe.diag']?.value).toMatchObject({ ports: { errors: 0 } })
      const diag = state['rabe.diag']?.value as { ports?: { lastError?: string } } | undefined
      expect(diag?.ports?.lastError).toBeUndefined()
    }
    if (found) {
      expect(calls).toContainEqual(['fuser', path])
      expect(calls).toContainEqual(['ps', '-A', '-o', 'pid=,ppid='])
      expect(calls).toContainEqual(['ss', '-ltnpH'])
      calls.length = 0
      await clock.advance(6000)
      expect(calls).toEqual([])
    }
    if (mode === 'non-linux') expect(calls).toEqual([['uname', '-s']])
    if (mode === 'ended' || mode === 'unsafe path' || mode === 'output port')
      expect(calls).toEqual([])
  })
}

test('a quick foreground call never pushes an ended agent out of a full cap', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  const agents = Array.from({ length: MAX_ENDED }, (_, n) => ({
    id: `agent:a${n}`,
    kind: 'agent',
    title: `a${n}`,
    status: 'done',
    seenAt: 100 + n,
    endedAt: 100 + n,
  }))
  const fg = {
    id: 'shell:fg-old',
    kind: 'shell',
    title: 'ls · foreground',
    status: 'done',
    seenAt: 4000,
    endedAt: 4000,
    detail: { command: 'ls' },
  }
  state['rabe.items'] = { value: [...agents, fg], version: 1 }
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items).toEqual(agents)
})

test('with a frozen clock the newest ended foreground rows stay', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  for (let i = 0; i < MAX_FOREGROUND + 5; i++) {
    await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
  }
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items).toHaveLength(MAX_FOREGROUND)
  expect(items.map(item => (item.detail as { command: string }).command)).toEqual(
    Array.from({ length: MAX_FOREGROUND }, (_, i) => `echo ${i + 5}`),
  )
})

test('ended detached codex exec rows the poll ends are not under the foreground cap', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  let written = false
  on('fs.stat', async (_$, e, next) =>
    written && e.path.startsWith('/tmp/r')
      ? { value: { kind: 'file' as const, size: 4, mtimeMs: 50_000, isLink: false } }
      : next(e),
  )
  bash(on)
  core(on)
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
  for (let i = 0; i <= MAX_FOREGROUND; i++) {
    await $.tool.call({ tool: 'Bash', command: `nohup codex exec -o /tmp/r${i}.txt x &` })
  }
  expect(state['rabe.items']?.value).toHaveLength(MAX_FOREGROUND + 1)
  written = true
  await clock.advance(60_000)
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items.map(item => item.status)).toEqual(Array(MAX_FOREGROUND + 1).fill('done'))
})

test('an interrupted detached codex exec ends as stopped', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  answering(on, { result: { stdout: '', stderr: '', interrupted: true }, text: 'ok' })
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'codex exec -o /tmp/r.txt x &' })
  expect(state['rabe.items']?.value).toMatchObject([{ status: 'stopped', endedAt: 1000 }])
})

test('a detached codex exec moved to the background leaves only its background row', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  answering(on, {
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
    text: `Command running in background with ID: b1. Output is being written to: ${DIR}/b1.output.`,
  })
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'nohup codex exec -o /tmp/r.txt x &' })
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items.map(item => item.id)).toEqual(['shell:b1'])
})

const CODEX =
  'codex exec -m gpt-6-sol -c model_reasoning_effort=high -s workspace-write -o $S/o.md - < b'

test('a background codex exec gets the codex facet', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: CODEX, run_in_background: true })
  expect(state['rabe.items']?.value).toMatchObject([
    {
      id: 'shell:b1',
      kind: 'shell',
      status: 'running',
      detail: { codex: { model: 'gpt-6-sol', effort: 'high', sandbox: 'workspace-write' } },
    },
  ])
})

test('a plain codex exec has an empty facet; other commands have none', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({
    tool: 'Bash',
    command: 'codex exec x',
    description: 'one',
    run_in_background: true,
  })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'two', run_in_background: true })
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items[0]?.detail).toMatchObject({ codex: {} })
  expect(items[1]?.detail).not.toHaveProperty('codex')
})

test('a foreground codex exec row gets the facet and ends as before', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: CODEX })
  expect(state['rabe.items']?.value).toMatchObject([
    { status: 'done', detail: { codex: { model: 'gpt-6-sol' } } },
  ])
})

test('at Stop a task row from the list gets the facet, without a duplicate', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b1', type: 'shell', status: 'running', description: 'dev', command: 'bun run dev' },
      { id: 'b7', type: 'shell', status: 'running', description: 'x', command: CODEX },
    ],
  })
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items.map(item => item.id)).toEqual(['shell:b1', 'shell:b7'])
  expect(items[1]?.detail).toMatchObject({ codex: { effort: 'high', sandbox: 'workspace-write' } })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b7', type: 'shell', status: 'running', description: 'x', command: CODEX },
    ],
  })
  expect(
    ((state['rabe.items']?.value ?? []) as RabeItem[]).filter(i => i.id === 'shell:b7'),
  ).toHaveLength(1)
})

test('ended codex exec rows are not under the foreground cap', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on)
  core(on)
  for (let i = 0; i < MAX_FOREGROUND + 5; i++) {
    await clock.set(1000 + i)
    await $.tool.call({ tool: 'Bash', command: `${CODEX} # ${i}` })
  }
  expect(state['rabe.items']?.value).toHaveLength(MAX_FOREGROUND + 5)
})
