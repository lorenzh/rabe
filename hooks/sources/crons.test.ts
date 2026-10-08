import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { core, memoryState } from '../testing'

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

test('a CronDelete call stops the job', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  tools(on)
  core(on)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: '/babysit-prs' })
  await clock.set(2000)
  await $.tool.call({ tool: 'CronDelete', id: 'c1' })
  expect(state['rabe.items']?.value).toEqual([{ ...cron, status: 'stopped', endedAt: 2000 }])
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
