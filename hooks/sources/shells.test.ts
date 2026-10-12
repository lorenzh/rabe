import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { RabeItem } from '../model'
import { MAX_ENDED } from '../registry'
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

test('a Bash call in the foreground adds nothing', async ($, on) => {
  const state = memoryState(on)
  bash(on)
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(state['rabe.items']?.value).toBeUndefined()
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
