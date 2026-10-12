import type { EngineInterface, On } from 'claude-code'
import type { Pollers } from '../loop'
import { itemId, type RabeItem } from '../model'
import { fileOffset, fileReset, outputLines, readChunk } from '../reading'
import {
  addItem,
  type Change,
  changeOf,
  commit,
  endItem,
  type Poll,
  prune,
  stage,
  updateItem,
} from '../registry'
import {
  appendLines,
  endStatus,
  parseNotifications,
  parseOutput,
  taskFolder,
  taskOutput,
} from '../tasks'

const MAX_READ = 4 * 1024 * 1024

// Each event takes one hook without a matcher per plugin; these match every event.
const ANY_STOP = { stop_hook_active: [true, false] }

type BackgroundTask = { id: string; type: string; description: string; command?: string }

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

let reading = Promise.resolve()

function readOutput($: EngineInterface, path: string, id: string): Promise<{ text?: string }> {
  const result = reading.then(() => readFile($, path, id))
  reading = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function readFile($: EngineInterface, path: string, id: string): Promise<{ text?: string }> {
  try {
    const folder = taskFolder(path, await $.session.id(), await $.session.root())
    if (!folder) return {}
    const root = await $.fs.stat(folder, { resolve: true })
    const stat = await $.fs.stat(path, { resolve: true })
    if (
      !root.realPath ||
      stat.realPath !== `${root.realPath}/${path.slice(path.lastIndexOf('/') + 1)}` ||
      stat.kind !== 'file'
    )
      return {}
    path = stat.realPath
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'monitorFiles' })
    const held = value[id]
    const identity = await $.process
      .run(['ls', '-diL', '--', path], { timeoutMs: 5000 })
      .then(result => (result.exitCode === 0 ? /^\s*(\d+)/.exec(result.stdout)?.[1] : undefined))
      .catch(() => undefined)
    if (!identity) {
      if (stat.size > MAX_READ) return {}
      const text = String(await $.fs.read(path))
      const parsed = parseOutput(text)
      await keepLines($, id, parsed.lines, false, false, parsed.ended !== undefined, true)
      return { text }
    }
    const stamp = { size: stat.size, mtimeMs: stat.mtimeMs, identity: `${path}:${identity}` }
    const offset = fileOffset(stamp, held)
    if (offset === undefined) return {}
    let text: string
    let truncated = false
    if (offset === 0 && stat.size <= MAX_READ) text = String(await $.fs.read(path))
    else {
      const result = await $.process.run(['tail', '-c', `+${offset + 1}`, '--', path], {
        timeoutMs: 5000,
      })
      if (result.exitCode !== 0) return {}
      text = result.stdout
      truncated = result.isStdoutTruncated
    }
    const chunk = readChunk(text, truncated, false, held?.isDiscarding)
    if (truncated && chunk.bytes === 0) return {}
    const parsed = parseOutput(chunk.text)
    await keepLines(
      $,
      id,
      parsed.lines,
      fileReset(stamp, held),
      !fileReset(stamp, held) && held?.partial === true,
      parsed.ended !== undefined,
    )
    await $.state.set(
      { plugin: 'rabe', key: 'monitorFiles' },
      {
        ...value,
        [id]: {
          ...stamp,
          offset: offset + chunk.bytes,
          partial: chunk.partial,
          isDiscarding: chunk.isDiscarding,
        },
      },
      { ifVersion: version },
    )
    return { text: chunk.text }
  } catch {
    return {}
  }
}

async function keepLines(
  $: EngineInterface,
  id: string,
  lines: string[],
  reset: boolean,
  partial: boolean,
  ended: boolean,
  whole = false,
): Promise<void> {
  const now = await $.clock.now()
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const next = whole
      ? appendLines(value[id], lines, now)
      : outputLines(value[id], lines, now, reset, partial, ended)
    if (!next) return
    if (JSON.stringify(next) === JSON.stringify(value[id])) return
    const { isSet } = await $.state.set(
      { plugin: 'rabe', key: 'lines' },
      { ...value, [id]: next },
      { ifVersion: version },
    )
    if (isSet) return
  }
}

function runningMonitors(items: RabeItem[]) {
  return items.flatMap(item => (item.kind === 'monitor' && item.status === 'running' ? [item] : []))
}

async function cleanFiles($: EngineInterface, items: RabeItem[]): Promise<void> {
  const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'monitorFiles' })
  const { value: current = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const next = prune(value, Object.keys(value), [...items, ...current])
  if (next !== value)
    await $.state.set({ plugin: 'rabe', key: 'monitorFiles' }, next, { ifVersion: version })
}

async function pollMonitors($: EngineInterface, items: RabeItem[]): Promise<Change> {
  const poll: Poll = { items, changes: [] }
  const { value: cursors = {} } = await $.state.get({ plugin: 'rabe', key: 'monitorFiles' })
  try {
    for (const item of items.filter((item): item is RabeItem & { kind: 'monitor' } => {
      const cursor = cursors[item.id]
      return (
        item.kind === 'monitor' &&
        (item.status === 'running' ||
          (cursor !== undefined && cursor.offset < cursor.size && !cursor.partial))
      )
    })) {
      const path =
        item.detail.outputPath ?? (item.detail.taskId && taskOutput(items, item.detail.taskId))
      if (!path) continue
      const ended = parseOutput((await readOutput($, path, item.id)).text ?? '').ended
      const now = await $.clock.now()
      stage(poll, held => {
        const next = updateItem(held, item.id, { detail: { outputPath: path } })

        return ended && item.status === 'running' ? endItem(next, item.id, ended, now) : next
      })
    }
  } catch {}
  await cleanFiles($, poll.items)
  return changeOf(poll, items)
}

async function onNotifications($: EngineInterface, text: string): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  for (const one of parseNotifications(text)) {
    const id = itemId('monitor', one.taskId)
    if (!one.status || !items.some(item => item.id === id)) continue
    if (one.outputFile) await readOutput($, one.outputFile, id)
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
    // A subagent's task may be missing from the main session's list; the poll
    // ends it from the exit line of its output file.
    if (item.parentId?.startsWith('agent:')) continue
    const ended =
      item.detail.outputPath &&
      parseOutput((await readOutput($, item.detail.outputPath, item.id)).text ?? '').ended
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

export function monitors(on: On, pollers: Pollers): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    pollers.push({ run: items => pollMonitors($, items), initial: false })
    return next(e)
  })
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
}
