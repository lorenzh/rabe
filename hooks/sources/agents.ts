import type {
  AgentInfo,
  AgentStatus,
  EngineInterface,
  On,
  TurnCompleteReason,
  TurnStepResult,
  TurnUsage,
} from 'claude-code'

import type { RabeEdit, RabeToolUse, RabeTurn } from '../../types'
import {
  clip,
  type EndStatus,
  itemId,
  type RabeItem,
  type RabeItemOf,
  type RabeItemStatus,
  type RabeTokens,
} from '../model'
import { addItem, type Change, commit, endItem, pastEnd, prune, updateItem } from '../registry'
import { changed, type Seen, shellWrites } from '../writes'

type Turns = Record<string, RabeTurn[]>
type AgentItem = RabeItemOf<'agent'>

const POLL_MS = 3000
const MAX_TURNS = 30
const MAX_EDITS = 100
const MAX_CHECKS = 20
const LOOK_MS = 1000
const MAX_TEXT = 300
const MAX_PROMPT = 600
const MAX_SUMMARY = 80
const SUMMARY_FIELDS = ['file_path', 'command', 'pattern', 'path', 'url', 'query', 'description']
const META_FIELDS = ['cwd', 'worktreePath', 'worktreeBranch', 'workflowPhase'] as const

const LISTED: Record<AgentStatus, RabeItemStatus> = {
  pending: 'running',
  running: 'running',
  waiting: 'running',
  idle: 'running',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

const ENDED: Record<TurnCompleteReason, EndStatus> = {
  answer: 'done',
  aborted: 'stopped',
  refusal: 'failed',
  error: 'failed',
}

export function toolSummary(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const fields = input as Record<string, unknown>
  const name = SUMMARY_FIELDS.find(one => typeof fields[one] === 'string')
  if (!name) return undefined
  const line = String(fields[name]).split('\n')[0] ?? ''

  // Effects tells files apart by the whole path.
  return name === 'file_path' ? line : line.slice(0, MAX_SUMMARY)
}

export function metaPatch(text: string): Partial<AgentItem['detail']> | undefined {
  try {
    const meta = JSON.parse(text) as Record<string, unknown>

    return Object.fromEntries(
      META_FIELDS.filter(name => typeof meta[name] === 'string').map(name => [name, meta[name]]),
    )
  } catch {
    return undefined
  }
}

export function metaPath(item: AgentItem, items: RabeItem[]): string | undefined {
  if (item.detail.transcriptPath)
    return item.detail.transcriptPath.replace(/\.jsonl$/, '.meta.json')
  const parent = items.find(one => one.id === item.parentId)
  if (parent?.kind !== 'workflow' || !parent.detail.transcriptDir) return undefined

  return `${parent.detail.transcriptDir}/agent-${item.detail.agentId}.meta.json`
}

export function agentTranscript(path: string, agentId: string): string | undefined {
  if (path.endsWith(`/agent-${agentId}.jsonl`)) return path
  if (!path.endsWith('.jsonl')) return undefined

  return `${path.slice(0, -'.jsonl'.length)}/subagents/agent-${agentId}.jsonl`
}

// The file an Edit or Write changed: the engine ran it (a result, no error) and
// did not only stage it for review. The path comes from the result when it has one.
export function changedFile(
  answer: { result?: unknown; isError?: boolean },
  input: string,
): string | undefined {
  if (answer.isError || !answer.result || typeof answer.result !== 'object') return undefined
  const result = answer.result as { filePath?: unknown; staged?: unknown }
  if (result.staged === true) return undefined

  return typeof result.filePath === 'string' ? result.filePath : input
}

// A Bash call that ran to its end: a result, no error, not interrupted and not
// moved to the background.
export function ranBash(answer: { result?: unknown; isError?: boolean }): boolean {
  if (answer.isError || !answer.result || typeof answer.result !== 'object') return false
  const result = answer.result as { interrupted?: unknown; backgroundTaskId?: unknown }

  return result.interrupted !== true && result.backgroundTaskId === undefined
}

// Changes to files of an agent; its newest MAX_EDITS are kept.
function edited(items: RabeItem[], id: string, changes: RabeEdit[]): RabeItem[] {
  const agent = asAgent(items, id)
  if (!agent) return items
  const edits = [...(agent.detail.edits ?? []), ...changes].slice(-MAX_EDITS)

  return updateItem(items, id, { detail: { edits } })
}

export function addTurn(turns: Turns, id: string, turn: RabeTurn): Turns {
  return { ...turns, [id]: [...(turns[id] ?? []), turn].slice(-MAX_TURNS) }
}

function addUsage(tokens: RabeTokens | undefined, usage: TurnUsage): RabeTokens {
  return {
    input:
      (tokens?.input ?? 0) +
      usage.input_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens,
    output: (tokens?.output ?? 0) + usage.output_tokens,
    cached: (tokens?.cached ?? 0) + usage.cache_read_input_tokens,
  }
}

function asAgent(items: RabeItem[], id: string): AgentItem | undefined {
  const item = items.find(one => one.id === id)

  return item?.kind === 'agent' ? item : undefined
}

// Statuses of a turn in flight: an ended agent in one was resumed. `idle` is
// not one: a teammate is idle after each turn, which already ended its item.
const RESUMED: AgentStatus[] = ['pending', 'running', 'waiting']

// An ended agent Rabe holds no item for takes `end` (see `pastEnd`), and none
// is added when `end` is undefined, so a poll never gives one a new recency.
function listed(
  items: RabeItem[],
  info: AgentInfo,
  now: number,
  end: number | undefined,
): RabeItem[] {
  const id = itemId('agent', info.id)
  const status = LISTED[info.status] ?? 'running'
  const held = asAgent(items, id)
  if (!held) {
    if (status !== 'running' && end === undefined) return items
    return addItem(
      items,
      {
        id,
        kind: 'agent',
        title: info.description || info.type,
        status,
        ...(status !== 'running' && { endedAt: end }),
        parentId: info.parentId ? itemId('agent', info.parentId) : undefined,
        detail: { agentId: info.id, type: info.type, description: info.description },
      },
      now,
    )
  }
  if (held.status !== 'running' && RESUMED.includes(info.status)) {
    return updateItem(items, id, { status: 'running', endedAt: undefined })
  }

  return status === 'running' ? items : endItem(items, id, status, now)
}

function stepped(
  items: RabeItem[],
  id: string,
  result: TurnStepResult,
  tools: RabeToolUse[],
  now: number,
): RabeItem[] {
  const item = asAgent(items, id)
  if (!item) return items
  const last = tools.at(-1)

  return updateItem(items, id, {
    status: 'running',
    endedAt: undefined,
    tokens: result.usage ? addUsage(item.tokens, result.usage) : item.tokens,
    detail: {
      model: result.usage?.model ?? item.detail.model,
      toolCount: (item.detail.toolCount ?? 0) + tools.length,
      lastTool: last?.name ?? item.detail.lastTool,
      lastToolAt: last ? now : item.detail.lastToolAt,
    },
  })
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

// Only a stat that failed with ENOENT or ENOTDIR says a path is absent;
// `$.fs.exists` also answers false for a folder it may not read.
function isMissing(error: unknown): boolean {
  return /\b(ENOENT|ENOTDIR)$/.test(error instanceof Error ? error.message : String(error))
}

// What is on disk at each path, or undefined when the looks outlast LOOK_MS.
async function look($: EngineInterface, paths: string[]): Promise<Seen[] | undefined> {
  const stop = new AbortController()
  const late = $.clock.sleep(LOOK_MS, { signal: stop.signal }).then(
    () => undefined,
    () => undefined,
  )
  const seen = Promise.all(
    paths.map(path =>
      $.fs.stat(path).then(
        (stat): Seen => stat,
        (error: unknown): Seen => (isMissing(error) ? 'none' : undefined),
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

// The call carries no cwd, so only absolute candidates are looked at.
async function beforeBash($: EngineInterface, command: string): Promise<Looked | undefined> {
  const home = await $.env.get('HOME')
  const paths = shellWrites(command, undefined, home)
    .map(one => one.path)
    .filter(path => path.startsWith('/'))
  if (paths.length === 0 || paths.length > MAX_CHECKS) return undefined
  const seen = await look($, paths)

  return seen && { paths, seen }
}

async function afterBash($: EngineInterface, agentId: string | undefined, before: Looked) {
  const after = await look($, before.paths)
  if (!after) return
  const at = await $.clock.now()
  const changes = before.paths.flatMap((path, n): RabeEdit[] => {
    const change = changed(before.seen[n], after[n])
    if (!change) return []
    return [{ path, at, via: 'shell', ...(change === 'delete' && { change }) }]
  })
  await record($, agentId, changes)
}

async function readMeta($: EngineInterface, id: string): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const item = asAgent(items, id)
  const path = item && metaPath(item, items)
  if (!path) return
  const text = await $.fs.read(path).catch(() => undefined)
  const patch = typeof text === 'string' ? metaPatch(text) : undefined
  if (patch) await write($, list => updateItem(list, id, { detail: patch }))
}

async function refresh($: EngineInterface): Promise<void> {
  const agents = await $.agent.list().catch(() => [])
  const now = await $.clock.now()
  await write($, items => {
    const end = pastEnd(items, now)

    return agents.reduce((list, info) => listed(list, info, now, end), items)
  })
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  for (const item of items) {
    if (item.kind === 'agent' && item.status === 'running') await readMeta($, item.id)
  }
}

async function recordStep($: EngineInterface, agentId: string, result: TurnStepResult) {
  const id = itemId('agent', agentId)
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  if (!asAgent(items, id)) return
  const now = await $.clock.now()
  const tools = result.toolUses.map(use => ({ name: use.name, summary: toolSummary(use.input) }))
  await write($, list => stepped(list, id, result, tools, now))
  if (!result.answer && tools.length === 0) return
  await writeTurns($, turns => {
    const index = (turns[id]?.at(-1)?.index ?? 0) + 1
    const turn = { index, at: now, text: clip(result.answer, MAX_TEXT), tools }

    return addTurn(turns, id, turn)
  })
}

export function agents(on: On): void {
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    $.clock.every(POLL_MS, () => refresh($))
    await refresh($)

    return next(e)
  })

  on('agent.spawn', { subagentType: /^/ }, async ($, e, next) => {
    const result = await next(e)
    const agentId = result.agentId
    if (!agentId) return result
    const now = await $.clock.now()
    const runId = e.workflow?.runId
    const parent = e.parentAgentId ? itemId('agent', e.parentAgentId) : undefined
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
    const cwd = await $.session.cwd().catch(() => e.cwd)
    const transcriptPath = agentTranscript(e.transcript_path, e.agent_id)
    const detail = {
      agentId: e.agent_id,
      ...(transcriptPath && { transcriptPath }),
      ...(e.cwd && { cwd: e.cwd }),
      ...(e.cwd && e.cwd !== cwd && { worktreePath: e.cwd }),
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
    if (e.agentId) await recordStep($, e.agentId, result)

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

  // The command line proposes files; a look on disk before and after decides.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const before =
      e.tool === 'Bash' ? await beforeBash($, e.command).catch(() => undefined) : undefined
    const answer = await next(e)
    try {
      if (before && ranBash(answer)) await afterBash($, e.agentId, before)
    } catch {}

    return answer
  })

  on('turn.complete', { agentId: /^/ }, async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (!agentId) return result
    const now = await $.clock.now()
    await write($, items => endItem(items, itemId('agent', agentId), ENDED[e.reason], now))
    await readMeta($, itemId('agent', agentId))

    return result
  })
}
