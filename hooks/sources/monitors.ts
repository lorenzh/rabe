import type { EngineInterface, On } from 'claude-code'

import { type EndStatus, itemId, type RabeItem } from '../model'
import { addItem, type Change, commit, endItem, updateItem } from '../registry'
import { appendLines, endStatus, parseNotifications, parseOutput, taskOutput } from '../tasks'

const POLL_MS = 2000
const MAX_READ = 4 * 1024 * 1024

// Each event takes one hook without a matcher per plugin; these match every event.
const ANY_START = { isInteractive: [true, false] }
const ANY_STOP = { stop_hook_active: [true, false] }

type BackgroundTask = { id: string; type: string; description: string; command?: string }

async function write($: Pick<EngineInterface, 'state'>, change: Change): Promise<void> {
  for (;;) {
    const { value, version } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = commit(value, change)
    if (next === undefined) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'items' }, next, {
      ifVersion: version,
    })
    if (isSet) return
  }
}

// ponytail: reads files up to 4 MiB whole; a larger monitor output is not followed
async function follow(
  $: EngineInterface,
  id: string,
  path: string,
): Promise<EndStatus | undefined> {
  try {
    const { size } = await $.fs.stat(path)
    if (size > MAX_READ) return undefined
    const { lines, ended } = parseOutput(String(await $.fs.read(path)))
    const now = await $.clock.now()
    for (;;) {
      const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
      const next = appendLines(value[id], lines, now)
      if (!next) break
      const { isSet } = await $.state.set(
        { plugin: 'rabe', key: 'lines' },
        { ...value, [id]: next },
        { ifVersion: version },
      )
      if (isSet) break
    }

    return ended
  } catch {
    return undefined
  }
}

function runningMonitors(items: RabeItem[]) {
  return items.flatMap(item => (item.kind === 'monitor' && item.status === 'running' ? [item] : []))
}

async function poll($: EngineInterface): Promise<void> {
  try {
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    for (const item of runningMonitors(items)) {
      const path =
        item.detail.outputPath ?? (item.detail.taskId && taskOutput(items, item.detail.taskId))
      if (!path) continue
      const ended = await follow($, item.id, path)
      const now = await $.clock.now()
      await write($, held => {
        const next = updateItem(held, item.id, { detail: { outputPath: path } })

        return ended ? endItem(next, item.id, ended, now) : next
      })
    }
  } catch {}
}

async function onNotifications($: EngineInterface, text: string): Promise<void> {
  for (const one of parseNotifications(text)) {
    if (!one.status) continue
    const id = itemId('monitor', one.taskId)
    if (one.outputFile) await follow($, id, one.outputFile)
    const now = await $.clock.now()
    await write($, held =>
      endItem(
        updateItem(held, id, { detail: one.outputFile ? { outputPath: one.outputFile } : {} }),
        id,
        endStatus(one.status),
        now,
      ),
    )
  }
}

async function correct($: EngineInterface, tasks: readonly BackgroundTask[]): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const inFlight = new Set(tasks.map(task => task.id))
  const now = await $.clock.now()
  for (const item of runningMonitors(items)) {
    if (!item.detail.taskId || inFlight.has(item.detail.taskId)) continue
    const ended = item.detail.outputPath && (await follow($, item.id, item.detail.outputPath))
    await write($, held => endItem(held, item.id, ended || 'stopped', now))
  }
  await write($, held =>
    tasks.reduce((next, task) => {
      const id = itemId('monitor', task.id)
      if (task.type !== 'monitor' || next.some(item => item.id === id)) return next
      const outputPath = taskOutput(next, task.id)

      return addItem(
        next,
        {
          id,
          kind: 'monitor',
          title: task.description,
          status: 'running',
          detail: {
            command: task.command ?? task.description,
            description: task.description,
            taskId: task.id,
            ...(outputPath && { outputPath }),
          },
        },
        now,
      )
    }, held),
  )
}

export function monitors(on: On): void {
  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const answer = await next(e)
    try {
      const result = answer.result as
        | { taskId?: string; timeoutMs?: number; persistent?: boolean }
        | undefined
      const taskId = result?.taskId
      if (e.tool === 'Monitor' && taskId) {
        const now = await $.clock.now()
        await write($, held => {
          const outputPath = taskOutput(held, taskId)

          return addItem(
            held,
            {
              id: itemId('monitor', taskId),
              kind: 'monitor',
              title: e.description,
              status: 'running',
              startedAt: now,
              ...(e.agentId && { parentId: itemId('agent', e.agentId) }),
              detail: {
                command: e.command ?? e.ws?.url ?? '',
                description: e.description,
                taskId,
                timeoutMs: result.timeoutMs ?? e.timeout_ms,
                isPersistent: result.persistent === true,
                ...(outputPath && { outputPath }),
              },
            },
            now,
          )
        })
      }
    } catch {}

    return answer
  })

  on('prompt.submit', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    try {
      await onNotifications($, e.text)
    } catch {}

    return next(e)
  })

  on('classic.Stop', ANY_STOP, async ($, e, next) => {
    try {
      if (e.background_tasks) await correct($, e.background_tasks)
    } catch {}

    return next(e)
  })

  on('session.start', ANY_START, async ($, e, next) => {
    $.clock.every(POLL_MS, () => void poll($))

    return next(e)
  })
}
