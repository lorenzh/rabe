import { expect, mock, test } from 'claude-code/testing'

import type { RabeItem } from './model'
import { core, files, memoryState } from './testing'
import { screen } from './ui/fixtures'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

test('one poll publishes agent discoveries and metadata together, then leaves unchanged items alone', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  core(on)
  on(
    'agent.list',
    async () =>
      ({
        value: [
          { id: 'a1', status: 'running', name: 'First' },
          { id: 'a2', status: 'running', name: 'Second' },
        ],
      }) as never,
  )
  files(on, {
    '/s/agent-a1.meta.json': '{"cwd":"/repo/a"}',
    '/s/agent-a2.meta.json': '{"cwd":"/repo/b"}',
  })
  state['rabe.items'] = {
    value: ['a1', 'a2'].map(id => ({
      id: `agent:${id}`,
      kind: 'agent',
      title: id,
      status: 'running',
      seenAt: 1000,
      detail: { agentId: id, transcriptPath: `/s/agent-${id}.jsonl` },
    })),
    version: 0,
  }
  await $.session.start(START)
  await clock.advance(0)
  expect(state['rabe.items']?.version).toBe(1)
  expect(((state['rabe.items']?.value ?? []) as RabeItem[]).map(item => item.title)).toEqual([
    'First',
    'Second',
  ])
  await clock.advance(3000)
  expect(state['rabe.items']?.version).toBe(1)
})

test('a slow poll skips ticks until it finishes', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  memoryState(on)
  core(on)
  let calls = 0
  let active = 0
  let most = 0
  on('agent.list', async () => {
    calls++
    active++
    most = Math.max(most, active)
    if (calls === 1) await clock.advance(6000)
    active--
    return { value: [] }
  })
  await $.session.start(START)
  await clock.advance(0)
  expect(most).toBe(1)
  expect(calls).toBe(1)
  await clock.advance(10_000)
  expect(calls).toBeGreaterThan(1)
})

test('band and pane keep the old counts during a poll and draw the completed tick together', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  core(on)
  let ended = false
  let release = () => {}
  let pause: Promise<void> | undefined
  on(
    'agent.list',
    async () =>
      ({
        value: [
          { id: 'a1', status: ended ? 'completed' : 'running', name: 'First' },
          { id: 'a2', status: 'running', name: 'Second' },
        ],
      }) as never,
  )
  on('fs.read', async (_$, e, next) => {
    if (e.path === '/s/agent-a2.meta.json') {
      if (pause) await pause
      return { value: '{}' }
    }
    return next(e)
  })
  state['rabe.items'] = {
    value: ['a1', 'a2'].map(id => ({
      id: `agent:${id}`,
      kind: 'agent',
      title: id === 'a1' ? 'First' : 'Second',
      status: 'running',
      seenAt: 1000,
      detail: { agentId: id, transcriptPath: `/s/agent-${id}.jsonl` },
    })),
    version: 0,
  }
  await $.session.start(START)
  const version = state['rabe.items']?.version ?? 0
  ended = true
  pause = new Promise(resolve => {
    release = resolve
  })
  await clock.advance(2000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      surface,
      plugin: 'rabe',
      component: 'AbovePrompt',
      requestId: 'band',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 120,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    } as never)
    const pane = await $.ui.mount({
      surface,
      plugin: 'rabe',
      component: 'Pane',
      requestId: 'rabe',
      props: {
        title: 'Rabe',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    } as never)
    expect((await screen(band)).join('\n')).toContain('2 claude')
    expect((await screen(pane)).join('\n')).toContain('2 running')
    await band.unmount()
    await pane.unmount()
  }
  pause = undefined
  release()
  await clock.advance(0)
  expect(state['rabe.items']?.version).toBe(version + 1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      surface,
      plugin: 'rabe',
      component: 'AbovePrompt',
      requestId: 'band',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 120,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    } as never)
    const pane = await $.ui.mount({
      surface,
      plugin: 'rabe',
      component: 'Pane',
      requestId: 'rabe',
      props: {
        title: 'Rabe',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    } as never)
    expect((await screen(band)).join('\n')).toContain('1 claude')
    expect((await screen(pane)).join('\n')).toContain('1 running')
    await band.unmount()
    await pane.unmount()
  }
})

test('idle polls back off, and a newly running item wakes the next tick', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  core(on)
  let calls = 0
  on('agent.list', async () => {
    calls++
    return { value: [] }
  })
  await $.session.start(START)
  await clock.advance(10_000)
  const idleCalls = calls
  await clock.advance(3000)
  expect(calls).toBe(idleCalls)
  state['rabe.items'] = {
    value: [
      {
        id: 'shell:b1',
        kind: 'shell',
        title: 'build',
        status: 'running',
        seenAt: 14_000,
        detail: { taskId: 'b1', command: 'build' },
      },
    ],
    version: 1,
  }
  await clock.advance(1000)
  expect(calls).toBe(idleCalls + 1)
})

test('an event write during a poll is kept when the staged changes commit', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  core(on)
  let release = () => {}
  let pause: Promise<void> | undefined
  on(
    'agent.list',
    async () => ({ value: [{ id: 'a1', status: 'running', name: 'First' }] }) as never,
  )
  on('fs.read', async (_$, e, next) => {
    if (e.path !== '/s/agent-a1.meta.json') return next(e)
    if (pause) await pause
    return { value: '{"cwd":"/repo"}' }
  })
  state['rabe.items'] = {
    value: [
      {
        id: 'agent:a1',
        kind: 'agent',
        title: 'First',
        status: 'running',
        seenAt: 1000,
        detail: { agentId: 'a1', transcriptPath: '/s/agent-a1.jsonl' },
      },
    ],
    version: 0,
  }
  await $.session.start(START)
  pause = new Promise(resolve => {
    release = resolve
  })
  await clock.advance(2000)
  const items = state['rabe.items']?.value as RabeItem[]
  state['rabe.items'] = {
    value: [
      ...items.map(item => ({ ...item, detail: { ...item.detail, cwd: undefined } })),
      {
        id: 'shell:b1',
        kind: 'shell',
        title: 'build',
        status: 'running',
        seenAt: 3000,
        detail: { command: 'build', taskId: 'b1' },
      },
    ],
    version: (state['rabe.items']?.version ?? 0) + 1,
  }
  pause = undefined
  release()
  await clock.advance(0)
  expect(((state['rabe.items']?.value ?? []) as RabeItem[]).map(item => item.id)).toEqual([
    'agent:a1',
    'shell:b1',
  ])
  expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.detail).toMatchObject({
    cwd: '/repo',
  })
})
