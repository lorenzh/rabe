import type { RabeCodexStep, RabeEdit, RabeRollout, RabeRolloutCursor } from '../../types'
import { clip, type EndStatus, itemId, type NewItem } from '../model'
import type { CodexRequest } from '../prices'
import { isRecord } from '../reading'
import { shellWrites } from '../writes'
import { MAX_EDITS } from './agent-items'

const MAX_STEPS = 50
const MAX_TEXT = 300
const CHANGES = ['add', 'update', 'delete'] as const
const MAX_CHECKS = 20

export type Rec = Record<string, unknown>

export type CodexJob = Rec & { id: string }

export type Rollout = RabeRollout

// A file a shell command may have written while it ran, from `from` to `to`.
type Check = { path: string; from: number; to: number }

export type CodexSession = {
  path?: string
  updatedAt?: number
  isMissing?: boolean
  isPartial?: boolean
  rollout?: Rollout
  // Set with `rollout`: the job's dollars, undefined when not known.
  usd?: number
}

export function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {}
}

function validStep(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['message', 'reasoning', 'command'].includes(value.kind as string) &&
    typeof value.text === 'string' &&
    (value.exitCode === undefined || typeof value.exitCode === 'number') &&
    (value.lines === undefined || typeof value.lines === 'number') &&
    (value.isRunning === undefined || typeof value.isRunning === 'boolean')
  )
}

function validEdit(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.at === 'number' &&
    (value.via === undefined || typeof value.via === 'string') &&
    (value.change === undefined || typeof value.change === 'string')
  )
}

function validTokens(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.input === 'number' &&
    typeof value.output === 'number' &&
    (value.cached === undefined || typeof value.cached === 'number')
  )
}

export function rolloutCursor(value: unknown): RabeRolloutCursor | undefined {
  if (
    !isRecord(value) ||
    !isRecord(value.out) ||
    !Array.isArray(value.out.steps) ||
    !value.out.steps.every(validStep) ||
    !Array.isArray(value.out.requests) ||
    typeof value.out.commandCount !== 'number' ||
    !Number.isFinite(value.out.commandCount) ||
    (value.out.edits !== undefined &&
      (!Array.isArray(value.out.edits) || !value.out.edits.every(validEdit))) ||
    (value.out.tokens !== undefined && !validTokens(value.out.tokens)) ||
    typeof value.total !== 'string' ||
    typeof value.isResumed !== 'boolean' ||
    !isRecord(value.pending) ||
    !Object.values(value.pending).every(
      index => typeof index === 'number' && Number.isInteger(index) && index >= 0,
    ) ||
    (value.base !== undefined && !isRecord(value.base)) ||
    (value.at !== undefined && (typeof value.at !== 'number' || !Number.isFinite(value.at))) ||
    (value.out.endedAt !== undefined && typeof value.out.endedAt !== 'number')
  )
    return
  return value as RabeRolloutCursor
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function parseJson(text: string): Rec | undefined {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? (value as Rec) : undefined
  } catch {
    return undefined
  }
}

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, one]) => one !== undefined)) as T
}

function texts(content: unknown, type: string): string {
  return list(content)
    .map(rec)
    .filter(part => part.type === type)
    .map(part => str(part.text) ?? '')
    .join('')
}

function shellLine(command: unknown): string {
  const argv = list(command).map(String)
  return argv.length === 3 && argv[1] === '-lc' ? (argv[2] as string) : argv.join(' ')
}

function pendingCommand(input: unknown): string {
  const text = String(input ?? '')
  const quoted = /cmd:\s*("(?:[^"\\]|\\.)*")/.exec(text)?.[1]
  if (quoted) {
    try {
      return JSON.parse(quoted)
    } catch {}
  }

  return text.split('\n')[0] ?? ''
}

// Codex writes the cwd as a `file://` URL.
function folder(cwd: unknown): string | undefined {
  const text = str(cwd)
  if (!text?.startsWith('file://')) return text
  try {
    return text.slice('file://'.length).split('/').map(decodeURIComponent).join('/')
  } catch {
    return undefined
  }
}

// The absolute files a command line may write; a command with more is skipped.
function commandChecks(item: Rec, from: number, to: number, home?: string): Check[] {
  const paths = shellWrites(shellLine(item.command), folder(item.cwd), home)
    .filter(one => !one.isDeleted && one.path.startsWith('/'))
    .map(one => one.path)

  return paths.length > MAX_CHECKS ? [] : paths.map(path => ({ path, from, to }))
}

function lineCount(output: unknown): number | undefined {
  const text = str(output)

  return text === undefined ? undefined : text.replace(/\n$/, '').split('\n').length
}

// The files a completed FileChange changed; a moved file leaves its old path.
function fileChanges(changes: unknown, at: number): RabeEdit[] {
  return Object.entries(rec(changes)).flatMap(([path, value]) => {
    const change = CHANGES.find(one => one === rec(value).type)
    const moved = str(rec(value).move_path)
    if (!change) return []
    const edit = (one: string, kind: RabeEdit['change']) =>
      ({ path: one, at, via: 'codex', change: kind }) as RabeEdit

    return moved ? [edit(path, 'delete'), edit(moved, 'add')] : [edit(path, change)]
  })
}

// A count that is missing makes the request one without a model: no price.
function request(value: unknown, model: string | undefined): CodexRequest {
  const usage = rec(value)
  const counts = [
    usage.input_tokens,
    usage.cached_input_tokens,
    usage.cache_write_input_tokens,
    usage.output_tokens,
  ].map(num)
  const [input = 0, cached = 0, write = 0, output = 0] = counts

  return { ...(!counts.includes(undefined) && { model }), input, cached, write, output }
}

// `since` is the job's start: a job that resumed a thread finds the turns of
// the jobs before it in the same file, and counts none of them. `until` is a
// finished job's end: the turns of jobs that resumed the thread later count
// nothing either.
export type RolloutCursor = RabeRolloutCursor

export function parseRollout(text: string, home?: string, since?: number, until?: number): Rollout {
  return advanceRollout(text, undefined, home, since, until).out
}

export function advanceRollout(
  text: string,
  held?: RolloutCursor,
  home?: string,
  since?: number,
  until?: number,
): RolloutCursor {
  const out: Rollout = held
    ? { ...held.out, requests: [], steps: [...held.out.steps] }
    : { requests: [], commandCount: 0, steps: [] }
  delete out.checks
  let total = held?.total ?? ''
  let base = held?.base
  let isResumed = held?.isResumed ?? false
  const edits: RabeEdit[] = [...(out.edits ?? [])]
  const checks: Check[] = []
  const pending = { ...held?.pending }
  let at = held?.at
  for (const raw of text.split('\n')) {
    const record = parseJson(raw)
    if (!record) continue
    const payload = rec(record.payload)
    const timestamp = Date.parse(str(record.timestamp) ?? '')
    if (until !== undefined && timestamp > until) continue
    if (Number.isFinite(timestamp)) at = Math.max(at ?? 0, timestamp)
    if (record.type === 'event_msg' && payload.type === 'task_complete') {
      out.endedAt = Number.isFinite(timestamp) ? timestamp : at
    } else if (record.type === 'event_msg' && payload.type === 'task_started') {
      delete out.endedAt
    }
    if (record.type === 'turn_context') {
      const settings = rec(rec(payload.collaboration_mode).settings)
      out.model = str(payload.model) ?? str(settings.model) ?? out.model
      out.effort = str(payload.effort) ?? str(settings.reasoning_effort) ?? out.effort
      out.sandbox = str(rec(payload.sandbox_policy).type) ?? out.sandbox
    } else if (since !== undefined && Date.parse(str(record.timestamp) ?? '') < since) {
      isResumed = true
      const info = rec(payload.info)
      if (payload.type === 'token_count' && Object.keys(info).length) {
        base = rec(info.total_token_usage)
        total = JSON.stringify(base)
      }
    } else if (record.type === 'event_msg' && payload.type === 'token_count') {
      const info = rec(payload.info)
      const usage = rec(info.total_token_usage)
      // the total counts the whole thread: a resumed job's share needs the total it started at
      const own = (key: string) => {
        const now = num(usage[key])
        if (!isResumed || now === undefined) return now
        const before = num(base?.[key])
        return before === undefined ? undefined : now - before
      }
      const input = own('input_tokens')
      const output = own('output_tokens')
      if (input !== undefined && output !== undefined) {
        out.tokens = defined({ input, output, cached: own('cached_input_tokens') })
      }
      // a record without counts (rate limits only) or that repeats the total adds no request
      const key = JSON.stringify(usage)
      if (Object.keys(info).length) {
        if (key !== total) out.requests.push(request(info.last_token_usage, out.model))
        total = key
      }
    } else if (record.type === 'event_msg' && payload.type === 'item_completed') {
      const item = rec(payload.item)
      const at = num(payload.completed_at_ms) ?? (Date.parse(str(record.timestamp) ?? '') || 0)
      if (item.type === 'UserMessage') out.prompt ??= str(texts(item.content, 'text'))
      if (item.type === 'FileChange' && item.status === 'completed') {
        edits.push(...fileChanges(item.changes, at))
      }
      const from = num(payload.started_at_ms)
      if (item.type === 'CommandExecution' && item.exit_code === 0 && from !== undefined) {
        checks.push(...commandChecks(item, from, at, home))
      }
      if (item.type === 'CommandExecution') {
        out.commandCount += 1
        out.steps.push(
          defined({
            kind: 'command' as const,
            text: clip(shellLine(item.command), MAX_TEXT),
            exitCode: num(item.exit_code),
            lines: lineCount(item.aggregated_output),
          }),
        )
      }
    } else if (record.type === 'response_item') {
      if (payload.type === 'message' && payload.role === 'assistant') {
        const message = texts(payload.content, 'output_text')
        if (message) out.steps.push({ kind: 'message', text: clip(message, MAX_TEXT) })
      } else if (payload.type === 'reasoning') {
        const summary = list(payload.summary)
          .map(part => str(rec(part).text))
          .filter(Boolean)
          .join('\n')
        if (summary) out.steps.push({ kind: 'reasoning', text: clip(summary, MAX_TEXT) })
      } else if (payload.type === 'custom_tool_call') {
        const step: RabeCodexStep = {
          kind: 'command',
          text: clip(pendingCommand(payload.input), MAX_TEXT),
          isRunning: true,
        }
        pending[String(payload.call_id)] = out.steps.length
        out.steps.push(step)
      } else if (payload.type === 'custom_tool_call_output') {
        const index = pending[String(payload.call_id)]
        if (index !== undefined) {
          out.steps.splice(index, 1)
          delete pending[String(payload.call_id)]
          for (const id of Object.keys(pending)) {
            if ((pending[id] ?? 0) > index) pending[id] = (pending[id] as number) - 1
          }
        }
      }
    }
  }
  const dropped = Math.max(0, out.steps.length - MAX_STEPS)
  out.steps = out.steps.slice(-MAX_STEPS)
  for (const id of Object.keys(pending)) {
    const index = (pending[id] as number) - dropped
    if (index < 0) delete pending[id]
    else pending[id] = index
  }
  if (edits.length) out.edits = edits.slice(-MAX_EDITS)
  if (checks.length) out.checks = checks.slice(-MAX_EDITS)

  return { out: defined(out), total, base, isResumed, pending, at }
}

export function jobEnd(status: unknown): EndStatus | undefined {
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'stopped'

  return undefined
}

export function jobStart(job: CodexJob): number | undefined {
  return Date.parse(str(job.startedAt) ?? str(job.createdAt) ?? '') || undefined
}

// a running job, or a finished one without its time, has no end to cut at
export function jobStop(job: CodexJob): number | undefined {
  return (jobEnd(job.status) && Date.parse(str(job.completedAt) ?? '')) || undefined
}

export function codexItem(job: CodexJob, session: CodexSession | undefined): NewItem {
  const rollout = session?.rollout
  // an unchanged session file is not parsed again; the held item keeps what it gave
  const request = session?.path && !rollout ? {} : rec(job.request)

  const item = defined({
    id: itemId('codex', job.id),
    kind: 'codex' as const,
    title: str(String(job.summary ?? '').split('\n')[0]) ?? str(job.title) ?? 'Codex job',
    status: 'running' as const,
    startedAt: jobStart(job),
    tokens: rollout?.tokens,
    detail: defined({
      jobId: job.id,
      jobKind: str(job.kindLabel),
      threadId: str(job.threadId),
      model: rollout?.model ?? str(request.model),
      effort: rollout?.effort ?? str(request.effort),
      sandbox: rollout?.sandbox,
      prompt: str(request.prompt) ?? rollout?.prompt,
      workspaceRoot: str(job.workspaceRoot),
      logPath: str(job.logFile),
      sessionPath: session?.path,
      sessionUpdatedAt: session?.updatedAt,
      isSessionMissing: session?.isMissing,
      isSessionPartial: session?.isPartial,
      commandCount: rollout?.commandCount,
      steps: rollout?.steps,
      edits: rollout?.edits,
    }),
  })

  // only an unchanged file keeps the cost; a parse, a gone or unreadable file sets it, also to unknown
  const isUnchanged = session?.updatedAt !== undefined && !rollout

  return session && !isUnchanged ? { ...item, costUsd: session.usd } : item
}

// Codex prints `session id: <uuid>` to stderr when it starts. One id names the
// thread; none, or two different ones, name none.
export function sessionIdOf(text: string): string | undefined {
  const ids = new Set(
    [...text.matchAll(/^session id: ([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/gm)].map(
      match => match[1],
    ),
  )

  return ids.size === 1 ? [...ids][0] : undefined
}

// The first record of a rollout a direct `codex exec` wrote: its thread id,
// start time and directory. Codex subagents and other clients write another `source`.
export type ExecMeta = { path: string; id: string; at: number; cwd?: string }

export function execMeta(first: string, path: string): ExecMeta | undefined {
  const record = parseJson(first)
  const payload = rec(record?.payload)
  const id = str(payload.id)
  if (record?.type !== 'session_meta' || payload.source !== 'exec' || !id) return undefined
  const at = Date.parse(str(payload.timestamp) ?? '') || Date.parse(str(record.timestamp) ?? '')
  if (!Number.isFinite(at)) return undefined
  const cwd = folder(payload.cwd)

  return { path, id, at, ...(cwd && { cwd }) }
}

// A rollout belongs to a run when it started from 5 s before the run's start
// to 10 s after it, in the run's `-C` directory when the command names one.
export const EXEC_BEFORE_MS = 5000
export const EXEC_AFTER_MS = 10_000

export type ExecRun = { id: string; startedAt: number; dir?: string }

const fits = (run: ExecRun, file: ExecMeta) =>
  file.at >= run.startedAt - EXEC_BEFORE_MS &&
  file.at <= run.startedAt + EXEC_AFTER_MS &&
  (run.dir === undefined || file.cwd === run.dir)

// Each run with exactly one fitting file that no other run fits too.
export function matchExec(runs: ExecRun[], files: ExecMeta[]): Map<string, ExecMeta> {
  const matched = new Map<string, ExecMeta>()
  for (const run of runs) {
    const [file, ...more] = files.filter(one => fits(run, one))
    if (file && more.length === 0 && runs.filter(one => fits(one, file)).length === 1) {
      matched.set(run.id, file)
    }
  }

  return matched
}
