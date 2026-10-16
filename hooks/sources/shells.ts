import type { EngineInterface, On } from 'claude-code'
import type { RabeFileCursor, RabeLines } from '../../types'
import { codexExec } from '../codex-exec'
import { fault, type Pollers, skipped, tally } from '../loop'
import { type EndStatus, itemId, type RabeItem } from '../model'
import { listeningPort, processTree } from '../ports'
import {
  cursorOf,
  inodeOf,
  isOwnFile,
  linesOf,
  nextCursor,
  outputUpdate,
  readChunk,
  readPlan,
  restored,
  unchanged,
} from '../reading'
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
  endStatus,
  guessPort,
  outputPathOf,
  parseNotifications,
  parseOutput,
  taskFolder,
  taskOutput,
} from '../tasks'

const MAX_READ = 4 * 1024 * 1024
// A running foreground call shows only after this long, so quick commands cause no flicker.
const SLOW_MS = 2000

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
    if (next === value) break
    const turns = await $.state.set({ plugin: 'rabe', key: 'turns' }, next, { ifVersion: version })
    if (turns.isSet) break
  }
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'diffs' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) return
    const diffs = await $.state.set({ plugin: 'rabe', key: 'diffs' }, next, { ifVersion: version })
    if (diffs.isSet) return
  }
}

let reading = Promise.resolve()

function readOutput(
  $: EngineInterface,
  path: string,
  id: string,
): Promise<Pick<RabeLines, 'ended' | 'exitCode' | 'port'> & { text?: string }> {
  const result = reading.then(() => readFile($, path, id))
  reading = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function checkedOutput($: EngineInterface, path: string) {
  const folder = taskFolder(path, await $.session.id(), await $.session.root())
  if (!folder) return undefined
  const root = await $.fs.stat(folder, { resolve: true })
  const stat = await $.fs.stat(path, { resolve: true })
  return isOwnFile(root, stat, path.slice(path.lastIndexOf('/') + 1)) && stat.realPath
    ? { path: stat.realPath, stat }
    : undefined
}

async function readFile(
  $: EngineInterface,
  path: string,
  id: string,
): Promise<Pick<RabeLines, 'ended' | 'exitCode' | 'port'> & { text?: string }> {
  try {
    const checked = await checkedOutput($, path)
    if (!checked) return {}
    path = checked.path
    const stat = checked.stat
    const { value: saved } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const value = restored(saved)
    const output = linesOf(value[id])
    const held = output?.cursor
    const same = held?.identity?.startsWith(`${path}:`) && unchanged(stat, held)
    if (same && held && (held.offset >= held.size || held.partial)) {
      skipped()
      return output ?? {}
    }
    const identity = same
      ? held?.identity?.slice(path.length + 1)
      : await $.process
          .run(['ls', '-diL', '--', path], { timeoutMs: 5000 })
          .then(result => (result.exitCode === 0 ? inodeOf(result.stdout) : undefined))
          .catch(() => undefined)
    if (!identity) {
      if (stat.size > MAX_READ) return {}
      const text = String(tally(await $.fs.read(path)))
      const parsed = parseOutput(text)
      await keepLines(
        $,
        id,
        parsed.lines,
        false,
        false,
        parsed.ended !== undefined,
        {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          identity: `${path}:`,
          offset: stat.size,
          partial: false,
        },
        {
          ended: parsed.ended,
          exitCode: parsed.exitCode,
          port: guessPort(text),
        },
        true,
      )
      return { text, ended: parsed.ended, exitCode: parsed.exitCode, port: guessPort(text) }
    }
    const stamp = { size: stat.size, mtimeMs: stat.mtimeMs, identity: `${path}:${identity}` }
    const plan = readPlan(stamp, held, MAX_READ)
    if (!plan) {
      skipped()
      return output ?? {}
    }
    const { offset, reset, whole } = plan
    let text: string
    let truncated = false
    if (whole) text = String(tally(await $.fs.read(path)))
    else {
      const result = await $.process.run(['tail', '-c', `+${offset + 1}`, '--', path], {
        timeoutMs: 5000,
      })
      if (result.exitCode !== 0) {
        fault(`tail exited with code ${result.exitCode}`)
        return {}
      }
      text = tally(result.stdout)
      truncated = result.isStdoutTruncated
    }
    const chunk = readChunk(text, truncated, false, reset ? false : held?.isDiscarding)
    if (truncated && chunk.bytes === 0) return {}
    const parsed = parseOutput(chunk.text)
    await keepLines(
      $,
      id,
      parsed.lines,
      reset,
      !reset && held?.partial === true,
      parsed.ended !== undefined,
      nextCursor(stamp, offset, chunk),
      { ended: parsed.ended, exitCode: parsed.exitCode, port: guessPort(chunk.text) },
    )
    return {
      text: chunk.text,
      ended: parsed.ended,
      exitCode: parsed.exitCode,
      port: guessPort(chunk.text),
    }
  } catch (error) {
    fault(error)
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
  cursor?: RabeFileCursor,
  result: Pick<RabeLines, 'ended' | 'exitCode' | 'port'> = {},
  whole = false,
): Promise<void> {
  const now = await $.clock.now()
  for (;;) {
    const { value: saved, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const value = restored(saved)
    const next = outputUpdate(
      linesOf(value[id]),
      lines,
      now,
      reset,
      partial,
      ended,
      cursor,
      result,
      whole,
    )
    if (!next) return
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

async function pollShells($: EngineInterface, items: RabeItem[]): Promise<Change> {
  const poll: Poll = { items, changes: [] }
  const { value } = await $.state.get({ plugin: 'rabe', key: 'lines' })
  const cursors = restored(value)
  try {
    for (const item of items.filter((item): item is RabeItem & { kind: 'shell' } => {
      const cursor = cursorOf(cursors[item.id]?.cursor)
      return (
        item.kind === 'shell' &&
        (item.status === 'running' ||
          (cursor !== undefined && cursor.offset < cursor.size && !cursor.partial))
      )
    })) {
      if (item.status === 'running' && item.detail.resultPath) {
        const stat = await $.fs.stat(item.detail.resultPath).catch(() => undefined)
        if (stat?.kind === 'file' && stat.mtimeMs >= (item.startedAt ?? 0)) {
          const now = await $.clock.now()
          stage(poll, held => endItem(held, item.id, 'done', now))
        }
        continue
      }
      const output = item.detail.outputPath
        ? await readOutput($, item.detail.outputPath, item.id)
        : {}
      if (!output.text && !output.ended && !output.port) continue
      const { exitCode, ended } = output
      const port = item.detail.port ?? output.port
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
  return changeOf(poll, items)
}

async function portCommand(
  $: EngineInterface,
  argv: string[],
  label = '',
): Promise<string | undefined> {
  try {
    const result = await $.process.run(argv, { timeoutMs: 5000 })
    if (
      (result.exitCode !== 0 &&
        !(argv[0] === 'fuser' && result.exitCode === 1 && !result.stdout.trim())) ||
      result.isStdoutTruncated ||
      result.isStderrTruncated ||
      (result.stderr.trim() && result.stderr.trim() !== label)
    ) {
      fault('port scan unavailable')
      return undefined
    }
    return result.stdout
  } catch (error) {
    return fault(error)
  }
}

async function pollPorts($: EngineInterface, items: RabeItem[]): Promise<Change> {
  const poll: Poll = { items, changes: [] }
  const paths: { id: string; path: string }[] = []
  for (const item of runningShells(items)) {
    if (!item.detail.outputPath || item.detail.port) continue
    const path = await checkedOutput($, item.detail.outputPath).catch(() => undefined)
    if (path) paths.push({ id: item.id, path: path.path })
  }
  if (!paths.length || (await portCommand($, ['uname', '-s']))?.trim() !== 'Linux')
    return changeOf(poll, items)
  const parents = await portCommand($, ['ps', '-A', '-o', 'pid=,ppid='])
  const sockets = await portCommand($, ['ss', '-ltnpH'])
  if (parents === undefined || sockets === undefined) return changeOf(poll, items)
  const live = new Set(
    parents.split('\n').flatMap(line => {
      const pid = /^\s*(\d+)\s+\d+\s*$/.exec(line)?.[1]
      return pid ? [Number(pid)] : []
    }),
  )
  for (const { id, path } of paths) {
    // fuser has no -- separator; the checked absolute task path cannot be an option.
    const holders = await portCommand($, ['fuser', path], `${path}:`)
    if (!holders || !/^\s*\d+(?:\s+\d+)*\s*$/.test(holders)) continue
    const roots = holders.trim().split(/\s+/).map(Number)
    if (!roots.every(pid => live.has(pid))) continue
    const port = listeningPort(sockets, processTree(roots, parents))
    if (!port) continue
    const portAt = await $.clock.now()
    stage(poll, held => {
      const item = held.find(item => item.id === id)
      return item?.kind === 'shell' && item.status === 'running' && !item.detail.port
        ? updateItem(held, id, { detail: { port, portAt } })
        : held
    })
  }
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
    const { exitCode, ended = 'stopped' } = item.detail.outputPath
      ? await readOutput($, item.detail.outputPath, item.id)
      : {}
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

type BashCall = { tool_use_id: string; command: string; description?: string; agentId?: string }

// The row of a foreground Bash call: running, or ended with `end` in the same write.
async function foreground(
  $: EngineInterface,
  e: BashCall,
  id: string,
  startedAt: number,
  { resultPath, end }: { resultPath?: string; end?: EndStatus } = {},
) {
  const now = await $.clock.now()
  await write($, held => {
    const added = addItem(
      held,
      {
        id,
        kind: 'shell',
        title: shellTitle(e.description, e.command, 'foreground'),
        status: 'running',
        startedAt: startedAt || now,
        ...(e.agentId && { parentId: itemId('agent', e.agentId) }),
        detail: { command: e.command, ...(resultPath && { resultPath }) },
      },
      now,
    )

    return end ? endItem(added, id, end, now) : added
  })
}

// How a returned foreground call ends: refused or interrupted stops it.
function endOf(answer: { deny?: string; isError?: boolean; result?: unknown }): EndStatus {
  const result = answer.result as { interrupted?: unknown } | undefined
  if (answer.deny || result?.interrupted === true) return 'stopped'

  return answer.isError ? 'failed' : 'done'
}

export function shells(on: On, pollers: Pollers): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    pollers.push({ name: 'shells', run: items => pollShells($, items), initial: false })
    pollers.push({ name: 'ports', run: items => pollPorts($, items), every: 6000, initial: false })
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.tool !== 'Bash') return next(e)
    const id = itemId('shell', `fg-${e.tool_use_id}`)
    const stop = new AbortController()
    let shown: Promise<void> | undefined
    let added = false
    let startedAt = 0
    let exec: ReturnType<typeof codexExec>
    if (!e.run_in_background) {
      try {
        startedAt = await $.clock.now()
        exec = codexExec(e.command, await $.env.get('HOME').catch(() => undefined))
        shown = $.clock
          .sleep(SLOW_MS, { signal: stop.signal })
          .then(() => foreground($, e, id, startedAt))
          .then(() => {
            added = true
          })
          .catch(() => undefined)
      } catch {}
    }
    let answer: Awaited<ReturnType<typeof next>>
    try {
      answer = await next(e)
    } catch (error) {
      stop.abort()
      await shown
      if (!e.run_in_background) {
        await foreground($, e, id, startedAt, { end: 'stopped' }).catch(() => undefined)
      }
      throw error
    }
    stop.abort()
    await shown
    try {
      const result = answer.result as { backgroundTaskId?: string } | undefined
      const taskId = result?.backgroundTaskId
      const now = await $.clock.now()
      const end = endOf(answer as Parameters<typeof endOf>[0])
      // A `codex exec ... &` that ran outlives the call: its result file ends the row.
      const keep = exec?.isDetached && end === 'done' && !taskId ? exec.resultPath : undefined
      if (keep) await foreground($, e, id, startedAt, { resultPath: keep })
      else if (!taskId && !e.run_in_background) await foreground($, e, id, startedAt, { end })
      if (taskId) {
        // Claude Code moved the call to the background: the task row replaces it.
        if (added) await write($, held => held.filter(item => item.id !== id))
        const outputPath = outputPathOf(answer.text)
        await write($, held =>
          addItem(
            held,
            {
              id: itemId('shell', taskId),
              kind: 'shell',
              title: shellTitle(e.description, e.command, taskId),
              status: 'running',
              startedAt: startedAt || now,
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
