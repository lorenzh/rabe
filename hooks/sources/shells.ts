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
  guessPort,
  outputPathOf,
  parseNotifications,
  parseOutput,
  taskFolder,
  taskOutput,
} from '../tasks'

const MAX_READ = 4 * 1024 * 1024

// Each event takes one hook without a matcher per plugin; these match every event.
const ANY_STOP = { stop_hook_active: [true, false] }

type BackgroundTask = { id: string; type: string; description?: string; command?: string }

const shellTitle = (description: string | undefined, command: string, id: string) =>
  `${(description || command).replace(/\s+/g, ' ').trim()} · ${id}`

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
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'shellFiles' })
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
      { plugin: 'rabe', key: 'shellFiles' },
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

function runningShells(items: RabeItem[]) {
  return items.flatMap(item => (item.kind === 'shell' && item.status === 'running' ? [item] : []))
}

async function cleanFiles($: EngineInterface, items: RabeItem[]): Promise<void> {
  const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'shellFiles' })
  const { value: current = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const next = prune(value, Object.keys(value), [...items, ...current])
  if (next !== value)
    await $.state.set({ plugin: 'rabe', key: 'shellFiles' }, next, { ifVersion: version })
}

async function pollShells($: EngineInterface, items: RabeItem[]): Promise<Change> {
  const poll: Poll = { items, changes: [] }
  const { value: cursors = {} } = await $.state.get({ plugin: 'rabe', key: 'shellFiles' })
  try {
    for (const item of items.filter((item): item is RabeItem & { kind: 'shell' } => {
      const cursor = cursors[item.id]
      return (
        item.kind === 'shell' &&
        (item.status === 'running' ||
          (cursor !== undefined && cursor.offset < cursor.size && !cursor.partial))
      )
    })) {
      const { text } = item.detail.outputPath
        ? await readOutput($, item.detail.outputPath, item.id)
        : {}
      if (!text) continue
      const { exitCode, ended } = parseOutput(text)
      const port = item.detail.port ?? guessPort(text)
      const now = await $.clock.now()
      const portAt = item.detail.portAt ?? (port ? now : undefined)
      stage(poll, held => {
        const next = updateItem(held, item.id, {
          detail: {
            ...(port && { port, portAt }),
            ...(exitCode !== undefined && { exitCode }),
          },
        })

        return ended && item.status === 'running' ? endItem(next, item.id, ended, now) : next
      })
    }
  } catch {}
  await cleanFiles($, poll.items)
  return changeOf(poll, items)
}

async function onNotifications($: EngineInterface, text: string): Promise<void> {
  const notes = parseNotifications(text).filter(one => one.status)
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  for (const one of notes) {
    const id = itemId('shell', one.taskId)
    const item = items.find(held => held.id === id)
    const path = one.outputFile ?? (item?.kind === 'shell' ? item.detail.outputPath : undefined)
    if (item && path) await readOutput($, path, id)
  }
  const now = await $.clock.now()
  await write($, held =>
    notes.reduce((items, one) => {
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
    // A subagent's task may be missing from the main session's list; the poll
    // ends it from the exit line of its output file.
    if (item.parentId?.startsWith('agent:')) continue
    const text =
      item.detail.outputPath && (await readOutput($, item.detail.outputPath, item.id)).text
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
          title: shellTitle(task.description, task.command, task.id),
          status: 'running',
          detail: { command: task.command, taskId: task.id, ...(outputPath && { outputPath }) },
        },
        now,
      )
    }, held),
  )
}

export function shells(on: On, pollers: Pollers): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    pollers.push({ run: items => pollShells($, items), initial: false })
    return next(e)
  })
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
              title: shellTitle(e.description, e.command, taskId),
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
}
