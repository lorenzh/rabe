import type {
  EngineInterface,
  On,
  ToolResultOf,
  TurnCompleteReason,
  TurnStepResult,
} from 'claude-code'

import type { RabeEdit } from '../../types'
import { companionCall } from '../forwarders'
import { fault, type Pollers, skipped, tally } from '../loop'
import { clip, type EndStatus, isAbsolute, isEnded, itemId, type RabeItem } from '../model'
import { claudeUsd, type Prices, parsePrices, withOverride } from '../prices'
import { isRecord, restored, unchanged } from '../reading'
import {
  addItem,
  type Change,
  changeOf,
  commit,
  endItem,
  type Poll,
  pastEnd,
  prune,
  stage,
  updateItem,
} from '../registry'
import { changed, type Seen, shellWrites } from '../writes'

import {
  addTurn,
  agentTranscript,
  answered,
  asAgent,
  called,
  changedFile,
  edited,
  LISTED,
  listed,
  MAX_EDITS,
  metaPatch,
  metaPath,
  ranBash,
  stepped,
  type Turns,
  toolSummary,
  workflowTranscript,
} from './agent-items'

export { addTurn, agentTranscript, metaPatch, metaPath, toolSummary } from './agent-items'

const MAX_ANSWER = 16000
const MAX_CHECKS = 20
const LOOK_MS = 1000
const MAX_PROMPT = 600

const ENDED: Record<TurnCompleteReason, EndStatus> = {
  answer: 'done',
  aborted: 'stopped',
  refusal: 'failed',
  error: 'failed',
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

async function writeTurns(
  $: Pick<EngineInterface, 'state'>,
  change: (turns: Turns) => Turns,
): Promise<void> {
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'turns' })
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'turns' }, change(value), {
      ifVersion: version,
    })
    if (isSet) return
  }
}

// The main session's changes go to `rabe.edits`, an agent's to its item.
async function record(
  $: EngineInterface,
  agentId: string | undefined,
  changes: RabeEdit[],
): Promise<void> {
  if (changes.length === 0) return
  if (agentId) {
    const id = itemId('agent', agentId)
    return write($, items => edited(items, id, changes))
  }
  for (;;) {
    const { value = [], version } = await $.state.get({ plugin: 'rabe', key: 'edits' })
    const next = [...value, ...changes].slice(-MAX_EDITS)
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'edits' }, next, {
      ifVersion: version,
    })
    if (isSet) return
  }
}

type Listings = Map<string, Promise<Set<string> | undefined>>

// A path whose stat failed is missing only when its folder lists without it,
// or that folder is missing itself; error text is never read.
function hasName(names: Set<string>, name: string): boolean {
  if (names.has(name)) return true
  const fold = (one: string) => one.normalize('NFC').toLowerCase()
  const wanted = fold(name)
  for (const one of names) if (fold(one) === wanted) return true

  return false
}

async function isMissing($: EngineInterface, path: string, lists: Listings): Promise<boolean> {
  const cut = path.lastIndexOf('/')
  if (cut < 0 || path === '/') return false
  const folder = path.slice(0, cut) || '/'
  let names = lists.get(folder)
  if (!names) {
    names = $.fs.list(folder).then(
      entries => new Set(entries.map(entry => entry.name)),
      () => undefined,
    )
    lists.set(folder, names)
  }
  const listed = await names
  // A name the folder lists in another case or Unicode form may be this file (macOS, Windows).
  if (listed) return !hasName(listed, path.slice(cut + 1))

  return folder !== '/' && isMissing($, folder, lists)
}

// What is on disk at each path, or undefined when the looks outlast LOOK_MS.
async function look($: EngineInterface, paths: string[]): Promise<Seen[] | undefined> {
  const stop = new AbortController()
  const late = $.clock.sleep(LOOK_MS, { signal: stop.signal }).then(
    () => undefined,
    () => undefined,
  )
  const lists: Listings = new Map()
  const seen = Promise.all(
    paths.map(path =>
      $.fs.stat(path).then(
        (stat): Seen => stat,
        async (): Promise<Seen> => ((await isMissing($, path, lists)) ? 'none' : undefined),
      ),
    ),
  )
  try {
    return await Promise.race([seen, late])
  } finally {
    stop.abort()
  }
}

type Looked = { paths: string[]; seen: Seen[] }

async function beforeBash(
  $: EngineInterface,
  command: string,
  agentId: string | undefined,
): Promise<Looked | undefined> {
  const home = await $.env.get('HOME')
  let candidates = shellWrites(command, undefined, home)
  if (candidates.some(one => !one.path.startsWith('/'))) {
    let cwd: string | undefined
    if (agentId) {
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      cwd = asAgent(items, itemId('agent', agentId))?.detail.cwd
    } else {
      cwd = await $.session.cwd().catch(() => undefined)
    }
    candidates = shellWrites(command, cwd, home)
  }
  const paths = candidates.map(one => one.path).filter(path => path.startsWith('/'))
  if (paths.length === 0 || paths.length > MAX_CHECKS) return undefined
  const seen = await look($, paths)

  return seen && { paths, seen }
}

async function afterBash(
  $: EngineInterface,
  agentId: string | undefined,
  before: Looked | undefined,
  result: unknown,
) {
  const after = before && (await look($, before.paths).catch(() => undefined))
  const at = await $.clock.now()
  const changes =
    before && after
      ? before.paths.flatMap((path, n): RabeEdit[] => {
          const change = changed(before.seen[n], after[n])
          if (!change) return []
          return [{ path, at, via: 'shell', ...(change === 'delete' && { change }) }]
        })
      : []
  const diff = (result as { bashEditDiff?: ToolResultOf<'Bash'>['bashEditDiff'] })?.bashEditDiff
  if (
    diff &&
    !diff.shared &&
    !diff.skipped &&
    !diff.unavailable &&
    Array.isArray(diff.changedFiles)
  ) {
    const paths = new Set(changes.map(one => one.path))
    for (const path of diff.changedFiles) {
      if (typeof path !== 'string' || !isAbsolute(path) || paths.has(path)) continue
      const deleted =
        Array.isArray(diff.files) &&
        diff.files.some(file => file?.filePath === path && file?.deleted === true)
      changes.push({ path, at, via: 'shell', ...(deleted && { change: 'delete' }) })
      paths.add(path)
    }
  }
  await record($, agentId, changes)
}

function cachedMeta(items: RabeItem[], id: string, data: Record<string, unknown>): RabeItem[] {
  const item = asAgent(items, id)
  if (!item) return items
  const detail: Record<string, unknown> = item.detail
  const missing = Object.fromEntries(
    Object.entries(data).filter(([key]) => detail[key] === undefined),
  )
  return updateItem(items, id, { detail: missing })
}

async function readMeta(
  $: EngineInterface,
  id: string,
  items: RabeItem[],
): Promise<Change | undefined> {
  const item = asAgent(items, id)
  const path = item && metaPath(item, items)
  if (!path) return
  const stat = await $.fs.stat(path).catch(fault)
  if (stat?.kind !== 'file') return
  const { value: saved, version } = await $.state.get({ plugin: 'rabe', key: 'agentFiles' })
  const value = restored(saved)
  const held = value[id]
  if (held?.path === path && isRecord(held.data) && unchanged(stat, held)) {
    skipped()
    return list => cachedMeta(list, id, held.data)
  }
  const text = await $.fs.read(path).then(tally, fault)
  const patch = typeof text === 'string' ? metaPatch(text) : undefined
  if (!patch) return
  await $.state.set(
    { plugin: 'rabe', key: 'agentFiles' },
    {
      ...value,
      [id]: { path, size: stat.size, mtimeMs: stat.mtimeMs, data: patch },
    },
    { ifVersion: version },
  )
  return list => updateItem(list, id, { detail: patch })
}

async function cleanFiles($: EngineInterface, items: RabeItem[]): Promise<void> {
  const { value: saved, version } = await $.state.get({ plugin: 'rabe', key: 'agentFiles' })
  const value = restored(saved)
  const { value: current = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const next = prune(value, Object.keys(value), [...items, ...current])
  if (next !== value)
    await $.state.set({ plugin: 'rabe', key: 'agentFiles' }, next, { ifVersion: version })
}

async function pollAgents($: EngineInterface, items: RabeItem[]): Promise<Change> {
  const poll: Poll = { items, changes: [] }
  const agents = await $.agent.list().catch(() => [])
  const now = await $.clock.now()
  stage(poll, items => {
    const end = pastEnd(items, now)

    return agents.reduce((list, info) => listed(list, info, now, end), items)
  })
  const { value: cached } = await $.state.get({ plugin: 'rabe', key: 'agentFiles' })
  const metadata = restored(cached)
  for (const item of poll.items) {
    if (item.kind !== 'agent') continue
    const workflow = poll.items.find(
      parent => parent.id === item.parentId && parent.kind === 'workflow',
    )
    if (
      item.status === 'running' ||
      (item.status === 'idle' && item.detail.isTeammate) ||
      (workflow?.kind === 'workflow' &&
        workflow.detail.phases?.length &&
        item.detail.workflowPhase === undefined)
    ) {
      const change = await readMeta($, item.id, poll.items)
      if (change) stage(poll, change)
    } else {
      const data = metadata[item.id]?.data
      if (isRecord(data)) stage(poll, list => cachedMeta(list, item.id, data))
    }
  }
  await cleanFiles($, poll.items)
  return changeOf(poll, items)
}

// The built-in table, or with the user's file (`pricesFile`) its rows first. A
// file that is set but cannot be read gives no prices: costs show n/a.
async function prices($: EngineInterface, file: string): Promise<Prices> {
  const read = (path: string) => $.fs.read(path).then(text => parsePrices(String(tally(text))))
  const built = await read(`${$.plugin.root}/data/prices.csv`).catch(e => fault(e, []))
  if (!file) return built
  const home = file.startsWith('~/') && (await $.env.get('HOME').catch(() => undefined))
  const own = await read(home ? `${home}${file.slice(1)}` : file).catch(fault)

  return own ? withOverride(built, own) : []
}

async function recordStep(
  $: EngineInterface,
  agentId: string,
  result: TurnStepResult,
  file: string,
) {
  const id = itemId('agent', agentId)
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  if (!asAgent(items, id)) return
  const now = await $.clock.now()
  const tools = result.toolUses.map(use => ({ name: use.name, summary: toolSummary(use.input) }))
  const usage = result.usage
  const usd = usage ? claudeUsd(await prices($, file), usage, usage.model) : undefined
  await write($, list => stepped(list, id, result, tools, now, usd))
  if (!result.answer && tools.length === 0) return
  await writeTurns($, turns => {
    const index = (turns[id]?.at(-1)?.index ?? 0) + 1
    const turn = { index, at: now, text: clip(result.answer, MAX_ANSWER), tools }

    return addTurn(turns, id, turn)
  })
}

export function agents(on: On, file: string, pollers: Pollers): void {
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    pollers.push({ name: 'agents', run: items => pollAgents($, items), every: 3000 })
    return next(e)
  })

  on('agent.spawn', { subagentType: /^/ }, async ($, e, next) => {
    const result = await next(e)
    const agentId = result.agentId
    if (!agentId) return result
    const now = await $.clock.now()
    const runId = e.workflow?.runId
    const parent = e.parentAgentId ? itemId('agent', e.parentAgentId) : undefined
    const id = itemId('agent', agentId)
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const transcriptPath = runId
      ? workflowTranscript(asAgent(items, id)?.detail.transcriptPath, agentId, runId)
      : undefined
    await write($, items =>
      addItem(
        items,
        {
          id: itemId('agent', agentId),
          kind: 'agent',
          title: e.description || e.subagentType,
          status: 'running',
          startedAt: now,
          parentId: runId ? itemId('workflow', runId) : parent,
          detail: {
            agentId,
            ...((e.isTeammate || result.teammateId) && { isTeammate: true }),
            ...(transcriptPath && { transcriptPath }),
            type: e.subagentType,
            model: result.model,
            description: e.description,
            prompt: clip(e.prompt, MAX_PROMPT),
            workflowIndex: e.workflow?.agentIndex,
          },
        },
        now,
      ),
    )

    return result
  }).catch((_$, e, next) => next(e))

  on('classic.SubagentStart', { agent_id: /^/ }, async ($, e, next) => {
    const transcriptPath = agentTranscript(e.transcript_path, e.agent_id)
    const detail = {
      agentId: e.agent_id,
      ...(transcriptPath && { transcriptPath }),
      ...(e.cwd && { cwd: e.cwd }),
    }
    const id = itemId('agent', e.agent_id)
    const now = await $.clock.now()
    await write($, items =>
      items.some(item => item.id === id)
        ? updateItem(items, id, { detail })
        : addItem(
            items,
            { id, kind: 'agent', title: e.agent_type, status: 'running', startedAt: now, detail },
            now,
          ),
    )

    return next(e)
  }).catch((_$, e, next) => next(e))

  on('turn.step', { agentId: /^/ }, async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId) await recordStep($, e.agentId, result, file)

    return result
  })

  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const answer = await next(e)
    try {
      const path = (e.tool === 'Edit' || e.tool === 'Write') && changedFile(answer, e.file_path)
      if (path) {
        const via = e.tool === 'Edit' ? 'edit' : 'write'
        await record($, e.agentId, [{ path, at: await $.clock.now(), via }])
      }
    } catch {}

    return answer
  })

  // Host diffs name script edits; disk checks confirm command-line candidates.
  // A call of the Codex companion is kept on its agent, so the Codex source can
  // link the job it starts (see forwarders.ts).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const before =
      e.tool === 'Bash'
        ? await beforeBash($, e.command, e.agentId).catch(() => undefined)
        : undefined
    const call = e.tool === 'Bash' && e.agentId ? companionCall(e.command) : undefined
    const id = itemId('agent', e.agentId ?? '')
    const at = call && (await $.clock.now().catch(() => undefined))
    if (call && at !== undefined) {
      await write($, items => called(items, id, at, call)).catch(() => undefined)
    }
    const answer = await next(e)
    try {
      if (at !== undefined) {
        const patch = answered(answer, await $.clock.now())
        await write($, items => called(items, id, at, patch))
      }
    } catch {}
    try {
      if (ranBash(answer)) await afterBash($, e.agentId, before, answer.result)
    } catch {}

    return answer
  })

  on('turn.complete', { agentId: /^/ }, async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (!agentId) return result
    const now = await $.clock.now()
    const id = itemId('agent', agentId)
    const info = (await $.agent.list().catch(() => [])).find(one => one.id === agentId)
    await write($, items => {
      const teammate = asAgent(items, id)?.detail.isTeammate || info?.teammateId
      const status = info && LISTED[info.status]
      if (teammate && (!status || !isEnded({ status }))) {
        return updateItem(items, id, {
          status: 'idle',
          endedAt: undefined,
          detail: { isTeammate: true },
        })
      }
      return endItem(items, id, teammate && status ? (status as EndStatus) : ENDED[e.reason], now)
    })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const change = await readMeta($, itemId('agent', agentId), items)
    if (change) await write($, change)

    return result
  })
}
