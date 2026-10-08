import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { core, files, memoryState } from '../testing'

const DIR = '/tmp/claude-1000/-home-me-app/5f1c/tasks'

function bash(on: On) {
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    const taskId = e.tool === 'Bash' && e.run_in_background ? (e.description ?? 'b1') : undefined

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
  title: 'bun run dev',
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

test('the poll reads the port and the exit line from the output file', async ($, on) => {
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
    { ...running, detail: { ...running.detail, port: 5173 } },
  ])
  held[`${DIR}/b1.output`] += '\n[exited with code 0]\n'
  await clock.advance(2000)
  expect(state['rabe.items']?.value).toEqual([
    {
      ...running,
      status: 'done',
      endedAt: 5000,
      detail: { ...running.detail, port: 5173, exitCode: 0 },
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
      title: 'tsc -w',
      status: 'running',
      seenAt: 1000,
      detail: { command: 'tsc -w', taskId: 'b0', outputPath: `${DIR}/b0.output` },
    },
  ])
})
