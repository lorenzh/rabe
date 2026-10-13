import type { EngineInterface, On, TurnCompleteReason } from 'claude-code'

import { type EndStatus, itemId, type RabeItem, type RabeItemOf } from '../model'
import { isRecord } from '../reading'
import { addItem, type Change, commit, endItem, prune, updateItem } from '../registry'

const LOOP_SENTINEL = '<<autonomous-loop-dynamic>>'
const SENTINEL = /^<<[\w.-]+>>$/
const WAKEUP = 'wakeup-'
// A wakeup fires when the session is idle, up to 90 s early for :00 and :30.
const FIRE_SLACK_MS = 90_000

// Each event takes one hook without a matcher per plugin; these match every event.
const ANY_START = { isInteractive: [true, false] }
const ANY_STOP = { stop_hook_active: [true, false] }

type Job = { id: string; schedule: string; prompt: string; humanSchedule?: string }

type Fires = {
  jobs: Record<string, { lastFiredAt: number; fireCount: number; fireId: string }>
  promptId?: string
  jobId?: string
  fireId?: string
}

// Only an exact fire/user pair proves identity; equal prompt text proves nothing.
export function cronFires(text: string): Fires {
  const fires = new Map<string, Record<string, unknown>>()
  const users = new Map<string, Record<string, unknown>>()
  const bad = new Set<string>()
  let promptId: string | undefined
  for (const line of text.split('\n')) {
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(row) || row.isSidechain === true || typeof row.uuid !== 'string') continue
    const fire = row.type === 'system' && row.subtype === 'scheduled_task_fire'
    const content = isRecord(row.message) ? row.message.content : undefined
    const tool =
      row.isToolResult === true ||
      (Array.isArray(content) &&
        content.some(part => isRecord(part) && part.type === 'tool_result'))
    if (!fire && (row.type !== 'user' || tool)) continue
    const records = fire ? fires : users
    const old = records.get(row.uuid)
    if (old && JSON.stringify(old) !== JSON.stringify(row)) bad.add(row.uuid)
    records.set(row.uuid, row)
    if (!fire) promptId = row.uuid
  }
  const pairs = new Map<string, Record<string, unknown>[]>()
  for (const row of users.values()) {
    if (typeof row.scheduledFireId !== 'string') continue
    const held = pairs.get(row.scheduledFireId) ?? []
    pairs.set(row.scheduledFireId, [...held, row])
  }
  const out: Fires = { jobs: {}, ...(promptId && { promptId }) }
  const jobs = new Map<string, Fires['jobs'][string]>()
  const ambiguous = new Set<string>()
  for (const [id, fire] of fires) {
    const matches = pairs.get(id) ?? []
    const user = matches[0]
    const at = typeof fire.timestamp === 'string' ? Date.parse(fire.timestamp) : NaN
    if (typeof fire.taskId !== 'string') continue
    if (
      matches.length !== 1 ||
      !user ||
      bad.has(id) ||
      bad.has(String(user.uuid)) ||
      user.scheduledTaskId !== fire.taskId ||
      user.parentUuid !== id ||
      !Number.isFinite(at)
    ) {
      ambiguous.add(fire.taskId)
      continue
    }
    const before = jobs.get(fire.taskId)
    jobs.set(fire.taskId, {
      lastFiredAt: Math.max(before?.lastFiredAt ?? at, at),
      fireCount: (before?.fireCount ?? 0) + 1,
      fireId: before && before.lastFiredAt > at ? before.fireId : id,
    })
    if (user.uuid === promptId) {
      out.jobId = fire.taskId
      out.fireId = id
    }
  }
  for (const id of ambiguous) jobs.delete(id)
  out.jobs = Object.fromEntries(jobs)
  if (out.jobId && !out.jobs[out.jobId]) {
    delete out.jobId
    delete out.fireId
  }
  return out
}

const TURN_END: Record<
  TurnCompleteReason,
  NonNullable<RabeItemOf<'cron'>['detail']['turnEnded']>
> = {
  answer: 'answered',
  aborted: 'stopped',
  error: 'error',
  refusal: 'refused',
}

function fireDetails(items: RabeItem[], read: Fires, reason?: TurnCompleteReason): RabeItem[] {
  return items.reduce((next, item) => {
    if (item.kind !== 'cron' || item.detail.scheduledFor !== undefined) return next
    const fire = Object.hasOwn(read.jobs, item.detail.jobId)
      ? read.jobs[item.detail.jobId]
      : undefined
    return updateItem(next, item.id, {
      detail: {
        lastFiredAt: fire?.lastFiredAt,
        fireCount: fire?.fireCount,
        fireId: fire?.fireId,
        turnEnded:
          reason && read.jobId === item.detail.jobId && read.fireId === fire?.fireId
            ? TURN_END[reason]
            : fire && fire.fireId === item.detail.fireId
              ? item.detail.turnEnded
              : undefined,
      },
    })
  }, items)
}

// `live` limits the scan to a session with a running cron job, so deleted and
// ended jobs cost no transcript read.
async function readFires($: EngineInterface, live = false): Promise<Fires | undefined> {
  try {
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    if (
      !items.some(
        item =>
          item.kind === 'cron' &&
          item.detail.scheduledFor === undefined &&
          (!live || item.status === 'running'),
      )
    )
      return
    const { value: path } = await $.state.get({ plugin: 'rabe', key: 'cronTranscript' })
    if (!path?.startsWith('/') || !path.endsWith('.jsonl')) return
    const result = await $.process.run(
      ['grep', '-F', '-e', '"scheduled_task_fire"', '-e', '"scheduledFireId"', '--', path],
      { timeoutMs: 5000 },
    )
    if ((result.exitCode !== 0 && result.exitCode !== 1) || result.isStdoutTruncated) return
    return cronFires(result.stdout)
  } catch {
    return undefined
  }
}

async function write($: Pick<EngineInterface, 'state'>, change: Change): Promise<void> {
  for (;;) {
    const { value, version } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = commit(value, change)
    if (next === undefined) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'items' }, next.items, {
      ifVersion: version,
    })
    if (isSet) return forget($, next.dropped)
  }
}

// Drops the lines and turns of the items a write dropped.
async function forget($: Pick<EngineInterface, 'state'>, dropped: string[]): Promise<void> {
  if (dropped.length === 0) return
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) break
    const lines = await $.state.set({ plugin: 'rabe', key: 'lines' }, next, { ifVersion: version })
    if (lines.isSet) break
  }
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'turns' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) return
    const turns = await $.state.set({ plugin: 'rabe', key: 'turns' }, next, { ifVersion: version })
    if (turns.isSet) return
  }
}

function runningCrons(items: RabeItem[]): RabeItemOf<'cron'>[] {
  return items.flatMap(item => (item.kind === 'cron' && item.status === 'running' ? [item] : []))
}

function isWakeup(item: RabeItemOf<'cron'>): boolean {
  return item.detail.jobId.startsWith(WAKEUP)
}

function endWakeups(items: RabeItem[], status: EndStatus, now: number, until = Infinity) {
  return dueWakeups(items, until).reduce((next, item) => endItem(next, item.id, status, now), items)
}

function dueWakeups(items: RabeItem[], until: number) {
  return runningCrons(items).filter(
    item => isWakeup(item) && (item.detail.scheduledFor ?? 0) <= until,
  )
}

// A due wakeup ends only on evidence that it fired: its own prompt, or the
// sentinel it was given (`<<autonomous-loop-dynamic>>`), which its expanded
// tick names. Other text, such as a recurring loop's tick, ends none.
function fired(items: RabeItem[], text: string, now: number): RabeItem[] {
  const prompt = text.trim()
  const ends = dueWakeups(items, now + FIRE_SLACK_MS).filter(item => {
    const own = item.detail.prompt.trim()

    return own === prompt || (SENTINEL.test(own) && text.includes(own))
  })

  return ends.reduce((next, item) => endItem(next, item.id, 'done', now), items)
}

function sync(items: RabeItem[], jobs: Job[], now: number): RabeItem[] {
  const listed = new Set(jobs.map(job => itemId('cron', job.id)))
  const running = runningCrons(items)
  const wakeupPrompts = new Set(running.filter(isWakeup).map(item => item.detail.prompt))
  const ended = running
    .filter(item => !isWakeup(item) && !listed.has(item.id))
    .reduce((next, item) => endItem(next, item.id, 'done', now), items)

  return jobs.reduce((next, job) => {
    const id = itemId('cron', job.id)
    if (wakeupPrompts.has(job.prompt) || next.some(item => item.id === id)) return next

    return addItem(
      next,
      {
        id,
        kind: 'cron',
        title: job.prompt,
        status: 'running',
        detail: {
          jobId: job.id,
          prompt: job.prompt,
          schedule: job.schedule,
          ...(job.humanSchedule && { humanSchedule: job.humanSchedule }),
        },
      },
      now,
    )
  }, ended)
}

async function list($: EngineInterface): Promise<void> {
  try {
    const answer = await $.tool.call({ tool: 'CronList' })
    if (!answer.result || answer.isError) return
    const jobs = answer.result.jobs.map(job => ({
      id: job.id,
      schedule: job.cron,
      prompt: job.prompt,
      humanSchedule: job.humanSchedule,
    }))
    const now = await $.clock.now()
    await write($, held => sync(held, jobs, now))
  } catch {}
}

export function crons(on: On): void {
  on('tool.call', { tool: 'CronCreate' }, async ($, e, next) => {
    const answer = await next(e)
    try {
      if (e.tool === 'CronCreate' && answer.result && !answer.isError) {
        const { id, humanSchedule } = answer.result as { id: string; humanSchedule?: string }
        const now = await $.clock.now()
        await write($, held =>
          addItem(
            held,
            {
              id: itemId('cron', id),
              kind: 'cron',
              title: e.prompt,
              status: 'running',
              startedAt: now,
              ...(e.agentId && { parentId: itemId('agent', e.agentId) }),
              detail: {
                jobId: id,
                prompt: e.prompt,
                schedule: e.cron,
                ...(humanSchedule && { humanSchedule }),
              },
            },
            now,
          ),
        )
      }
    } catch {}

    return answer
  })

  on('tool.call', { tool: 'CronDelete' }, async ($, e, next) => {
    const answer = await next(e)
    try {
      if (e.tool === 'CronDelete' && answer.result && !answer.isError) {
        const now = await $.clock.now()
        const id = itemId('cron', e.id)
        await write($, held =>
          updateItem(endItem(held, id, 'stopped', now), id, { detail: { isDeleted: true } }),
        )
      }
    } catch {}

    return answer
  })

  on('tool.call', { tool: 'ScheduleWakeup' }, async ($, e, next) => {
    const answer = await next(e)
    try {
      if (e.tool === 'ScheduleWakeup' && answer.result && !answer.isError) {
        const { scheduledFor, stopped } = answer.result as {
          scheduledFor: number
          stopped?: boolean
        }
        const now = await $.clock.now()
        const prompt = e.prompt ?? ''
        await write($, held =>
          stopped || e.stop
            ? endWakeups(held, 'stopped', now)
            : addItem(
                endWakeups(held, 'done', now),
                {
                  id: itemId('cron', `${WAKEUP}${scheduledFor}`),
                  kind: 'cron',
                  title: prompt === LOOP_SENTINEL ? 'autonomous loop' : prompt,
                  status: 'running',
                  startedAt: now,
                  ...(e.agentId && { parentId: itemId('agent', e.agentId) }),
                  detail: { jobId: `${WAKEUP}${scheduledFor}`, prompt, scheduledFor },
                },
                now,
              ),
        )
      }
    } catch {}

    return answer
  })

  on('prompt.submit', { origin: { kind: 'scheduled-trigger' } }, async ($, e, next) => {
    try {
      const now = await $.clock.now()
      await write($, held => fired(held, e.text, now))
    } catch {}

    return next(e)
  })

  on('classic.Stop', ANY_STOP, async ($, e, next) => {
    try {
      if (!e.agent_id) {
        const { value } = await $.state.get({ plugin: 'rabe', key: 'cronTranscript' })
        if (value !== e.transcript_path) {
          await $.state.set({ plugin: 'rabe', key: 'cronTranscript' }, e.transcript_path)
        }
      }
      if (e.session_crons) {
        const jobs = e.session_crons.map(job => ({
          id: job.id,
          schedule: job.schedule,
          prompt: job.prompt,
        }))
        const now = await $.clock.now()
        await write($, held => sync(held, jobs, now))
      }
    } catch {}

    return next(e)
  })

  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    if (!e.agentId) {
      try {
        await $.state.set({ plugin: 'rabe', key: 'cronTurn' }, { promptId: e.uuid })
      } catch {}
    }
    return next(e)
  })

  on('turn.step', { index: 0 }, async function* ($, e, next) {
    if (!e.agentId) {
      try {
        const { value, version } = await $.state.get({ plugin: 'rabe', key: 'cronTurn' })
        const read = await readFires($, true)
        if (read) {
          await write($, items => fireDetails(items, read))
          await $.state.set(
            { plugin: 'rabe', key: 'cronTurn' },
            {
              ...(read.jobId &&
                read.promptId === value?.promptId && {
                  promptId: read.promptId,
                  turnId: e.turnId,
                  fireId: read.fireId,
                }),
            },
            { ifVersion: version },
          )
        }
      } catch {}
    }
    return yield* next(e)
  })

  on('turn.complete', { reason: ['answer', 'aborted', 'error', 'refusal'] }, async ($, e, next) => {
    if (!e.agentId) {
      try {
        const { value, version } = await $.state.get({ plugin: 'rabe', key: 'cronTurn' })
        // Only this turn's own fire has an outcome to record, even for a cron that ended meanwhile.
        const read = value?.turnId === e.turnId ? await readFires($) : undefined
        if (read) {
          // A newer prompt may have replaced the link while the scan ran.
          const { value: now } = await $.state.get({ plugin: 'rabe', key: 'cronTurn' })
          const matches =
            now?.turnId === e.turnId &&
            now.promptId === value?.promptId &&
            now.fireId === value?.fireId &&
            now.promptId === read.promptId &&
            now.fireId === read.fireId
          await write($, items => fireDetails(items, read, matches ? e.reason : undefined))
        }
        await $.state.set({ plugin: 'rabe', key: 'cronTurn' }, {}, { ifVersion: version })
      } catch {}
    }
    return next(e)
  })

  on('session.start', ANY_START, async ($, e, next) => {
    await list($)
    const read = await readFires($)
    if (read) {
      try {
        await write($, items => fireDetails(items, read))
      } catch {}
    }

    return next(e)
  })
}
