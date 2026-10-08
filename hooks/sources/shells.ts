import type { EngineInterface, On } from 'claude-code'

import { itemId, type RabeItem } from '../model'
import { addItem, type Change, commit, endItem, updateItem } from '../registry'
import {
  endStatus,
  guessPort,
  outputPathOf,
  parseNotifications,
  parseOutput,
  taskOutput,
} from '../tasks'

const POLL_MS = 2000
const MAX_READ = 4 * 1024 * 1024
const TAIL_BYTES = '1048576'

// Each event takes one hook without a matcher per plugin; these match every event.
const ANY_START = { isInteractive: [true, false] }
const ANY_STOP = { stop_hook_active: [true, false] }

type BackgroundTask = { id: string; type: string; command?: string }

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

async function readOutput($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    const { size } = await $.fs.stat(path)
    if (size <= MAX_READ) return String(await $.fs.read(path))
    const { stdout } = await $.process.run(['tail', '-c', TAIL_BYTES, path])

    return stdout
  } catch {
    return undefined
  }
}

function runningShells(items: RabeItem[]) {
  return items.flatMap(item => (item.kind === 'shell' && item.status === 'running' ? [item] : []))
}

async function poll($: EngineInterface): Promise<void> {
  try {
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    for (const item of runningShells(items)) {
      const text = item.detail.outputPath && (await readOutput($, item.detail.outputPath))
      if (!text) continue
      const { exitCode, ended } = parseOutput(text)
      const port = item.detail.port ?? guessPort(text)
      const now = await $.clock.now()
      await write($, held => {
        const next = updateItem(held, item.id, {
          detail: { ...(port && { port }), ...(exitCode !== undefined && { exitCode }) },
        })

        return ended ? endItem(next, item.id, ended, now) : next
      })
    }
  } catch {}
}

async function onNotifications($: EngineInterface, text: string): Promise<void> {
  const now = await $.clock.now()
  await write($, held =>
    parseNotifications(text).reduce((items, one) => {
      if (!one.status) return items
      const id = itemId('shell', one.taskId)
      const next = updateItem(items, id, {
        detail: {
          ...(one.exitCode !== undefined && { exitCode: one.exitCode }),
          ...(one.outputFile && { outputPath: one.outputFile }),
        },
      })

      return endItem(next, id, endStatus(one.status, one.exitCode), now)
    }, held),
  )
}

async function correct($: EngineInterface, tasks: readonly BackgroundTask[]): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const inFlight = new Set(tasks.map(task => task.id))
  const now = await $.clock.now()
  for (const item of runningShells(items)) {
    if (!item.detail.taskId || inFlight.has(item.detail.taskId)) continue
    const text = item.detail.outputPath && (await readOutput($, item.detail.outputPath))
    const { exitCode, ended = 'stopped' } = parseOutput(text || '')
    await write($, held =>
      endItem(
        updateItem(held, item.id, { detail: exitCode === undefined ? {} : { exitCode } }),
        item.id,
        ended,
        now,
      ),
    )
  }
  await write($, held =>
    tasks.reduce((next, task) => {
      const id = itemId('shell', task.id)
      // Claude Code lists a Monitor tool task as type 'shell' too.
      const known = [id, itemId('monitor', task.id)]
      if (task.type !== 'shell' || !task.command || next.some(item => known.includes(item.id))) {
        return next
      }
      const outputPath = taskOutput(items, task.id)

      return addItem(
        next,
        {
          id,
          kind: 'shell',
          title: task.command,
          status: 'running',
          detail: { command: task.command, taskId: task.id, ...(outputPath && { outputPath }) },
        },
        now,
      )
    }, held),
  )
}

export function shells(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const answer = await next(e)
    try {
      const result = answer.result as { backgroundTaskId?: string } | undefined
      const taskId = result?.backgroundTaskId
      if (e.tool === 'Bash' && taskId) {
        const now = await $.clock.now()
        const outputPath = outputPathOf(answer.text)
        await write($, held =>
          addItem(
            held,
            {
              id: itemId('shell', taskId),
              kind: 'shell',
              title: e.command,
              status: 'running',
              startedAt: now,
              ...(e.agentId && { parentId: itemId('agent', e.agentId) }),
              detail: { command: e.command, taskId, ...(outputPath && { outputPath }) },
            },
            now,
          ),
        )
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
