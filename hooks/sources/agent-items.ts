import type { AgentInfo, AgentStatus, TurnStepResult, TurnUsage } from 'claude-code'
import type { RabeCodexCall, RabeEdit, RabeModelPair, RabeToolUse, RabeTurn } from '../../types'
import { companionOutput } from '../forwarders'
import {
  clip,
  type EndStatus,
  isEnded,
  itemId,
  type RabeItem,
  type RabeItemOf,
  type RabeItemStatus,
  type RabeTokens,
} from '../model'
import { parseJson } from '../reading'
import { addItem, endItem, updateItem } from '../registry'

export type Turns = Record<string, RabeTurn[]>
type AgentItem = RabeItemOf<'agent'>

const MAX_TURNS = 30
export const MAX_EDITS = 100
const MAX_CALLS = 10
const MAX_PAIRS = 6
const MAX_SUMMARY = 80
const SUMMARY_FIELDS = ['file_path', 'command', 'pattern', 'path', 'url', 'query', 'description']
const META_FIELDS = ['cwd', 'worktreePath', 'worktreeBranch', 'workflowPhase'] as const

export const LISTED: Record<AgentStatus, RabeItemStatus> = {
  pending: 'running',
  running: 'running',
  waiting: 'running',
  idle: 'running',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

export function toolSummary(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const fields = input as Record<string, unknown>
  const name = SUMMARY_FIELDS.find(one => typeof fields[one] === 'string')
  if (!name) return undefined
  const line = String(fields[name]).split('\n')[0] ?? ''

  // Effects tells files apart by the whole path.
  return name === 'file_path' ? line : clip(line, MAX_SUMMARY)
}

export function metaPatch(text: string): Partial<AgentItem['detail']> | undefined {
  const meta = parseJson(text)
  if (!meta) return undefined

  return Object.fromEntries(
    META_FIELDS.filter(name => typeof meta[name] === 'string').map(name => [name, meta[name]]),
  )
}

export function metaPath(item: AgentItem, items: RabeItem[]): string | undefined {
  const parent = items.find(one => one.id === item.parentId)
  if (parent?.kind === 'workflow') {
    const folder =
      parent.detail.transcriptDir ??
      parent.detail.scriptPath?.replace(
        /\/workflows\/scripts\/[^/]+$/,
        `/subagents/workflows/${parent.detail.runId}`,
      )
    if (folder && folder !== parent.detail.scriptPath)
      return `${folder}/agent-${item.detail.agentId}.meta.json`
  }

  return item.detail.transcriptPath?.replace(/\.jsonl$/, '.meta.json')
}

export function agentTranscript(path: string, agentId: string): string | undefined {
  if (path.endsWith(`/agent-${agentId}.jsonl`)) return path
  if (!path.endsWith('.jsonl')) return undefined

  return `${path.slice(0, -'.jsonl'.length)}/subagents/agent-${agentId}.jsonl`
}

export function workflowTranscript(
  path: string | undefined,
  agentId: string,
  runId: string,
): string | undefined {
  const generic = `/subagents/agent-${agentId}.jsonl`
  return path?.endsWith(generic)
    ? `${path.slice(0, -generic.length)}/subagents/workflows/${runId}/agent-${agentId}.jsonl`
    : path
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
export function edited(items: RabeItem[], id: string, changes: RabeEdit[]): RabeItem[] {
  const agent = asAgent(items, id)
  if (!agent) return items
  const edits = [...(agent.detail.edits ?? []), ...changes].slice(-MAX_EDITS)

  return updateItem(items, id, { detail: { edits } })
}

// The companion calls of an agent: a new one, or what its answer told.
export function called(
  items: RabeItem[],
  id: string,
  at: number,
  patch: Partial<RabeCodexCall>,
): RabeItem[] {
  const agent = asAgent(items, id)
  if (!agent) return items
  const calls = agent.detail.codexCalls ?? []
  const codexCalls = calls.some(one => one.at === at)
    ? calls.map(one => (one.at === at ? { ...one, ...patch } : one))
    : [...calls, { at, ...patch } as RabeCodexCall].slice(-MAX_CALLS)

  return updateItem(items, id, { detail: { codexCalls } })
}

// A call that went to the background still runs: it keeps no end. A failed
// run still printed its thread.
export function answered(answer: { result?: unknown }, now: number): Partial<RabeCodexCall> {
  const result = (answer.result ?? {}) as Record<string, unknown>
  if (result.backgroundTaskId) return {}

  return { endedAt: now, ...companionOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`) }
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

// Each step adds its own price, so a long-context step bills at its own tier. The
// sum is known only while every step since the start was: an agent Rabe did not
// see start, or one step without a price, stays n/a.
function addCost(item: AgentItem, usd: number | undefined): number | undefined {
  if (usd === undefined || item.startedAt === undefined) return undefined
  if (!item.tokens) return usd

  return item.costUsd === undefined ? undefined : item.costUsd + usd
}

export function asAgent(items: RabeItem[], id: string): AgentItem | undefined {
  const item = items.find(one => one.id === id)

  return item?.kind === 'agent' ? item : undefined
}

// Statuses of a turn in flight: an ended agent in one was resumed. `idle` is
// not one for plain subagents: only teammates stay alive between turns.
const RESUMED: AgentStatus[] = ['pending', 'running', 'waiting']

// An ended agent Rabe holds no item for takes `end` (see `pastEnd`), and none
// is added when `end` is undefined, so a poll never gives one a new recency.
export function listed(
  items: RabeItem[],
  info: AgentInfo,
  now: number,
  end: number | undefined,
): RabeItem[] {
  const id = itemId('agent', info.id)
  const held = asAgent(items, id)
  const teammate = info.teammateId || held?.detail.isTeammate
  const status = info.status === 'idle' && teammate ? 'idle' : (LISTED[info.status] ?? 'running')
  if (!held) {
    if (isEnded({ status }) && end === undefined) return items
    return addItem(
      items,
      {
        id,
        kind: 'agent',
        title: info.name || info.description || info.type,
        status,
        ...(isEnded({ status }) && { endedAt: end }),
        parentId: info.parentId ? itemId('agent', info.parentId) : undefined,
        detail: {
          agentId: info.id,
          ...(info.teammateId && { isTeammate: true }),
          ...(info.name && { name: info.name }),
          type: info.type,
          description: info.description,
        },
      },
      now,
    )
  }
  const named =
    info.name || info.teammateId
      ? updateItem(items, id, {
          ...(info.name && { title: info.name }),
          detail: {
            ...(info.name && { name: info.name }),
            ...(info.teammateId && { isTeammate: true }),
          },
        })
      : items
  if (teammate && (status === 'running' || status === 'idle')) {
    return updateItem(named, id, { status, endedAt: undefined })
  }
  if (held.status !== 'running' && RESUMED.includes(info.status)) {
    return updateItem(named, id, { status: 'running', endedAt: undefined })
  }

  return isEnded({ status }) ? endItem(named, id, status as EndStatus, now) : named
}

// A change is a pair that differs from the last one; a pair seen before and left
// again counts as a change. The newest MAX_PAIRS are kept.
export function withPair(held: RabeModelPair[] = [], pair: RabeModelPair): RabeModelPair[] {
  const last = held.at(-1)
  if (last?.model === pair.model && last.effort === pair.effort) return held

  return [...held, pair].slice(-MAX_PAIRS)
}

// `<synthetic>` marks an abort or an error, not a model.
export function pairOf(model: string | undefined, effort: unknown): RabeModelPair | undefined {
  if (!model || model === '<synthetic>') return undefined

  return { model, ...(effort !== undefined && effort !== '' && { effort: String(effort) }) }
}

// `opus-5-5·high → sonnet-5-5·medium`; a model without effort shows n/a.
export function pairsText(pairs: RabeModelPair[]): string {
  return pairs.map(p => `${p.model.replace(/^claude-/, '')}·${p.effort ?? 'n/a'}`).join(' → ')
}

export function stepped(
  items: RabeItem[],
  id: string,
  result: TurnStepResult,
  tools: RabeToolUse[],
  now: number,
  usd: number | undefined,
  pair?: RabeModelPair,
): RabeItem[] {
  const item = asAgent(items, id)
  if (!item) return items
  const last = tools.at(-1)

  return updateItem(items, id, {
    status: 'running',
    endedAt: undefined,
    tokens: result.usage ? addUsage(item.tokens, result.usage) : item.tokens,
    costUsd: result.usage ? addCost(item, usd) : item.costUsd,
    detail: {
      model: result.usage?.model ?? item.detail.model,
      ...(pair && { models: withPair(item.detail.models, pair) }),
      toolCount: (item.detail.toolCount ?? 0) + tools.length,
      lastTool: last?.name ?? item.detail.lastTool,
      lastToolAt: last ? now : item.detail.lastToolAt,
    },
  })
}
