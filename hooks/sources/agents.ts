import type {
  AgentInfo,
  AgentStatus,
  EngineInterface,
  On,
  TurnCompleteReason,
  TurnStepResult,
  TurnUsage,
} from 'claude-code'

import type { RabeToolUse, RabeTurn } from '../../types'
import {
  clip,
  type EndStatus,
  itemId,
  type RabeItem,
  type RabeItemOf,
  type RabeItemStatus,
  type RabeTokens,
} from '../model'
import { addItem, type Change, commit, endItem, updateItem } from '../registry'

type Turns = Record<string, RabeTurn[]>
type AgentItem = RabeItemOf<'agent'>

const POLL_MS = 3000
const MAX_TURNS = 30
const MAX_EDITS = 100
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

// An Edit or Write the engine ran for an agent; its newest MAX_EDITS are kept.
function edited(items: RabeItem[], id: string, path: string, at: number): RabeItem[] {
  const agent = asAgent(items, id)
  if (!agent) return items
  const edits = [...(agent.detail.edits ?? []), { path, at }].slice(-MAX_EDITS)

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

// An ended agent the cap dropped (`evicted`) is not added back.
function listed(items: RabeItem[], info: AgentInfo, now: number, evicted: string[]): RabeItem[] {
  const id = itemId('agent', info.id)
  const status = LISTED[info.status] ?? 'running'
  if (!asAgent(items, id)) {
    if (status !== 'running' && evicted.includes(id)) return items
    return addItem(
      items,
      {
        id,
        kind: 'agent',
        title: info.description || info.type,
        status,
        parentId: info.parentId ? itemId('agent', info.parentId) : undefined,
        detail: { agentId: info.id, type: info.type, description: info.description },
      },
      now,
    )
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
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'items' }, next, {
      ifVersion: version,
    })
    if (isSet) return
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
  const { value: evicted = [] } = await $.state.get({ plugin: 'rabe', key: 'evicted' })
  await write($, items => agents.reduce((list, info) => listed(list, info, now, evicted), items))
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
      if (
        (e.tool === 'Edit' || e.tool === 'Write') &&
        e.agentId &&
        answer.result &&
        !answer.isError
      ) {
        const id = itemId('agent', e.agentId)
        const now = await $.clock.now()
        await write($, items => edited(items, id, e.file_path, now))
      }
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
