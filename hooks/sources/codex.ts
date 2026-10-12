import type { EngineInterface, FsStat, On } from 'claude-code'

import type { RabeCodexStep, RabeEdit, RabeRollout, RabeRolloutCursor } from '../../types'
import { linkForwarders } from '../forwarders'
import { fault, type Pollers, skipped, tally } from '../loop'
import {
  clip,
  type EndStatus,
  itemId,
  type NewItem,
  type RabeItem,
  type RabeItemOf,
} from '../model'
import { type CodexRequest, codexUsd, type Prices, parsePrices, withOverride } from '../prices'
import { byteLength, inodeOf, readChunk, readPlan, unchanged } from '../reading'
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
import { shellWrites } from '../writes'

const CODEX_DATA = 'plugins/data/codex-openai-codex'
const CODEX_PLUGIN = 'codex@openai-codex'
const MAX_READ = 4 * 1024 * 1024
const RUN_MS = 5000
const MAX_STEPS = 50
const MAX_TEXT = 300
const MAX_EDITS = 100
const CHANGES = ['add', 'update', 'delete'] as const
const DAY = 24 * 60 * 60 * 1000
const MAX_CHECKS = 20
const LATE_MS = 2000
const LOOK_MS = 1000

type Rec = Record<string, unknown>

export type CodexJob = Rec & { id: string }

export type Rollout = RabeRollout

// A file a shell command may have written while it ran, from `from` to `to`.
export type Check = { path: string; from: number; to: number }

export type CodexSession = {
  path?: string
  updatedAt?: number
  isMissing?: boolean
  isPartial?: boolean
  rollout?: Rollout
  // Set with `rollout`: the job's dollars, undefined when not known.
  usd?: number
}

function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function parseJson(text: string): Rec | undefined {
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

function jobStart(job: CodexJob): number | undefined {
  return Date.parse(str(job.startedAt) ?? str(job.createdAt) ?? '') || undefined
}

// a running job, or a finished one without its time, has no end to cut at
function jobStop(job: CodexJob): number | undefined {
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

async function homes($: EngineInterface): Promise<{ home: string; claude: string; codex: string }> {
  const home = (await $.env.get('HOME')) ?? ''

  return {
    home,
    claude: (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`,
    codex: (await $.env.get('CODEX_HOME')) ?? `${home}/.codex`,
  }
}

async function findRollout(
  $: EngineInterface,
  codexHome: string,
  threadId: string,
  startedAt: number,
): Promise<string | undefined> {
  for (const offset of [0, -DAY, DAY]) {
    const day = new Date(startedAt + offset).toISOString().slice(0, 10).replaceAll('-', '/')
    const dir = `${codexHome}/sessions/${day}`
    const entries = await $.fs.list(dir).catch(e => fault(e, []))
    const found = entries.find(entry => entry.name.endsWith(`-${threadId}.jsonl`))
    if (found) return `${dir}/${found.name}`
  }

  return undefined
}

// One poll's shell checks: each path is statted once, and all share one deadline.
type Looks = {
  asked: Map<string, Promise<void>>
  known: Map<string, FsStat>
  late?: Promise<void>
  stop: AbortController
}

function statOnce($: EngineInterface, looks: Looks, path: string): Promise<void> {
  let asked = looks.asked.get(path)
  if (!asked) {
    asked = $.fs.stat(path).then(
      stat => {
        looks.known.set(path, stat)
      },
      () => undefined,
    )
    looks.asked.set(path, asked)
  }

  return asked
}

// A shell write counts when its file was changed while the command ran; a
// delete leaves nothing to look at, so only FileChange records give those.
async function confirmed($: EngineInterface, rollout: Rollout, looks: Looks): Promise<Rollout> {
  const { checks, ...rest } = rollout
  if (!checks) return rollout
  looks.late ??= $.clock.sleep(LOOK_MS, { signal: looks.stop.signal }).catch(() => undefined)
  await Promise.race([Promise.all(checks.map(one => statOnce($, looks, one.path))), looks.late])
  const written = checks.flatMap(({ path, from, to }): RabeEdit[] => {
    const stat = looks.known.get(path)
    const isWritten = stat?.kind === 'file' && stat.mtimeMs >= from && stat.mtimeMs <= to + LATE_MS

    return isWritten ? [{ path, at: to, via: 'shell' }] : []
  })
  const edits = [...(rest.edits ?? []), ...written].sort((a, b) => a.at - b.at).slice(-MAX_EDITS)

  return edits.length ? { ...rest, edits } : rest
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

async function readSession(
  $: EngineInterface,
  codexHome: string,
  job: CodexJob,
  held: RabeItemOf<'codex'> | undefined,
  looks: Looks,
  file: string,
): Promise<CodexSession | undefined> {
  const threadId = str(job.threadId)
  if (!threadId) return undefined
  const path =
    held?.detail.sessionPath ??
    (await findRollout($, codexHome, threadId, jobStart(job) ?? (await $.clock.now())))
  const stat = path ? await $.fs.stat(path).catch(fault) : undefined
  if (!path || !stat) {
    if (jobEnd(job.status)) return { isMissing: true }

    // a file seen before and gone now: no new fields, but the cost is no longer known
    return held?.detail.sessionPath ? { path } : undefined
  }
  const updatedAt = stat.mtimeMs
  const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'rollouts' })
  const key = itemId('codex', job.id)
  const saved = value[key]
  const until = jobStop(job)
  const since = jobStart(job)
  const previous =
    saved?.path === path &&
    saved.since === since &&
    (saved.until === until || (until !== undefined && (saved.parser.at ?? 0) <= until))
      ? saved
      : undefined
  const same = previous && unchanged(stat, previous.cursor)
  if (
    (same && (previous.cursor.offset >= previous.cursor.size || previous.cursor.partial)) ||
    (!saved && updatedAt === held?.detail.sessionUpdatedAt)
  ) {
    skipped()
    return { path, updatedAt }
  }
  const identity = same
    ? previous.cursor.identity
    : await $.process
        .run(['ls', '-diL', '--', path], { timeoutMs: RUN_MS })
        .then(result =>
          result.exitCode === 0
            ? inodeOf(result.stdout)
            : fault(`inode lookup exited with code ${result.exitCode}`),
        )
        .catch(fault)
  if (!identity) {
    if (stat.size > MAX_READ) return { path }
    const text = await $.fs.read(path).then(tally, fault)
    if (text === undefined) return { path }
    const rollout = await confirmed(
      $,
      parseRollout(String(text), await $.env.get('HOME'), jobStart(job), until),
      looks,
    )
    return { path, updatedAt, rollout, usd: codexUsd(await prices($, file), rollout.requests) }
  }
  const stamp = { size: stat.size, mtimeMs: stat.mtimeMs, identity }
  const plan = readPlan(stamp, previous?.cursor, MAX_READ)
  if (!plan) {
    skipped()
    return { path, updatedAt }
  }
  const { offset, reset, whole } = plan
  const home = await $.env.get('HOME')
  let text: string
  let truncated = false
  if (whole) {
    const read = await $.fs.read(path).then(tally, fault)
    if (read === undefined) return { path }
    text = String(read)
  } else {
    const result = await $.process
      .run(['tail', '-c', `+${offset + 1}`, '--', path], { timeoutMs: RUN_MS })
      .catch(fault)
    if (!result) return { path }
    text = tally(result.stdout)
    if (result.exitCode !== 0) {
      fault(`tail exited with code ${result.exitCode}`)
      return { path }
    }
    truncated = result.isStdoutTruncated
  }
  const chunk = readChunk(text, truncated, true, previous?.cursor.isDiscarding)
  if (truncated && chunk.bytes === 0) return { path }
  const parser = advanceRollout(
    chunk.text,
    reset ? undefined : previous?.parser,
    home,
    jobStart(job),
    until,
  )
  const rollout = await confirmed($, parser.out, looks)
  parser.out = { ...rollout, requests: [] }
  const cost = rollout.requests.length ? codexUsd(await prices($, file), rollout.requests) : 0
  const isUnpriced = (!reset && previous?.isUnpriced === true) || cost === undefined
  const hasRequests = (!reset && previous?.hasRequests === true) || rollout.requests.length > 0
  const usd = (reset ? 0 : (previous?.usd ?? 0)) + (cost ?? 0)
  const cursor = {
    ...stamp,
    offset: offset + chunk.bytes,
    partial: chunk.partial,
    isDiscarding: chunk.isDiscarding,
  }
  const hasSkipped = (!reset && previous?.hasSkipped === true) || chunk.isDiscarding === true
  await $.state.set(
    { plugin: 'rabe', key: 'rollouts' },
    {
      ...value,
      [key]: { path, cursor, parser, usd, until, isUnpriced, hasRequests, hasSkipped, since },
    },
    { ifVersion: version },
  )
  const isPartial = hasSkipped || truncated || offset + byteLength(text) < stat.size
  return {
    path,
    updatedAt,
    rollout,
    isPartial,
    usd: isPartial || isUnpriced || !hasRequests ? undefined : usd,
  }
}

async function readJson(
  $: EngineInterface,
  path: string,
  known?: FsStat,
): Promise<Rec | undefined> {
  const stat = known ?? (await $.fs.stat(path).catch(fault))
  if (stat?.kind !== 'file') return undefined
  const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'codexFiles' })
  const held = value[path]
  if (unchanged(stat, held)) {
    skipped()
    return held?.data
  }
  const read = await $.fs.read(path).then(tally, fault)
  const text = typeof read === 'string' ? read : ''
  const parsed = parseJson(text)
  if (!parsed) return undefined
  await $.state.set(
    { plugin: 'rabe', key: 'codexFiles' },
    {
      ...value,
      [path]: { size: stat.size, mtimeMs: stat.mtimeMs, data: parsed },
    },
    { ifVersion: version },
  )
  return parsed
}

async function refresh(
  $: EngineInterface,
  sessionId: string,
  codexHome: string,
  jobPath: string,
  entry: CodexJob,
  items: RabeItem[],
  looks: Looks,
  file: string,
  poll: Poll,
): Promise<void> {
  const saved = await readJson($, jobPath)
  const job: CodexJob = { ...entry, ...saved, id: entry.id }
  if (job.sessionId !== sessionId) return
  const held = items.find((one): one is RabeItemOf<'codex'> => one.id === itemId('codex', job.id))
  const end =
    jobEnd(job.status) ??
    (held?.status === 'done' || held?.status === 'failed' || held?.status === 'stopped'
      ? held.status
      : undefined)
  const now = await $.clock.now()
  const endedAt = Date.parse(str(job.completedAt) ?? '') || held?.endedAt || now
  const change = (item: NewItem) => (list: RabeItem[]) => {
    const added = addItem(list, item, now)

    return end ? endItem(added, item.id, end, endedAt) : added
  }
  // a finished job the cap would drop again: its session file is not read
  if (!held && commit(items, change(codexItem(job, undefined))) === undefined) return
  const session = await readSession($, codexHome, job, held, looks, file)
  stage(poll, change(codexItem(job, session)))
}

async function cleanFiles(
  $: EngineInterface,
  items: RabeItem[],
  workspaces: Set<string>,
): Promise<void> {
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'rollouts' })
    const { value: current = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, Object.keys(value), [...items, ...current])
    if (next === value) break
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'rollouts' }, next, {
      ifVersion: version,
    })
    if (isSet) break
  }
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'codexFiles' })
    const { value: current = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const ids = new Set(
      [...items, ...current].filter(item => item.kind === 'codex').map(item => item.id),
    )
    const entries = Object.entries(value).filter(([path, entry]) => {
      const jobId = /\/jobs\/([^/]+)\.json$/.exec(path)?.[1]
      return jobId
        ? ids.has(itemId('codex', jobId)) &&
            workspaces.has(path.replace(/\/jobs\/[^/]+\.json$/, '/state.json'))
        : workspaces.has(path) &&
            list(entry.data.jobs).some(job => ids.has(itemId('codex', str(rec(job).id) ?? '')))
    })
    if (entries.length === Object.keys(value).length) return
    const { isSet } = await $.state.set(
      { plugin: 'rabe', key: 'codexFiles' },
      Object.fromEntries(entries),
      { ifVersion: version },
    )
    if (isSet) return
  }
}

async function pollCodex($: EngineInterface, file: string, items: RabeItem[]): Promise<Change> {
  const poll: Poll = { items, changes: [] }
  const { claude, codex } = await homes($)
  const { value: cursors = {} } = await $.state.get({ plugin: 'rabe', key: 'rollouts' })
  const workspaces = new Set<string>()
  const stateRoot = `${claude}/${CODEX_DATA}/state`
  const sessionId = await $.session.id()
  const { startedAt: since } = await $.session.usage()
  const looks: Looks = { asked: new Map(), known: new Map(), stop: new AbortController() }
  // ponytail: one stat per workspace folder per poll; keep a folder list in $.state if there are hundreds
  for (const dir of await $.fs.list(stateRoot).catch(e => fault(e, []))) {
    if (dir.kind !== 'dir') continue
    const statePath = `${stateRoot}/${dir.name}/state.json`
    const stat = await $.fs.stat(statePath).catch(fault)
    if (!stat || stat.mtimeMs < since) continue
    workspaces.add(statePath)
    const state = await readJson($, statePath, stat)
    for (const entry of list(state?.jobs).map(rec)) {
      const id = str(entry.id)
      // the plugin's state.json can hold a bare status patch; its job file has the session
      // the id names a file in jobs/, so it must stay a plain file name
      if (!id || !/^\w[\w.-]*$/.test(id)) continue
      if (entry.sessionId !== undefined && entry.sessionId !== sessionId) continue
      const held = items.find((one): one is RabeItemOf<'codex'> => one.id === itemId('codex', id))
      const cursor = cursors[itemId('codex', id)]?.cursor
      const backlog = cursor && cursor.offset < cursor.size && !cursor.partial
      if (held && held.status !== 'running' && !backlog) continue
      await refresh(
        $,
        sessionId,
        codex,
        `${stateRoot}/${dir.name}/jobs/${id}.json`,
        { ...entry, id },
        items,
        looks,
        file,
        poll,
      ).catch(fault)
    }
  }
  looks.stop.abort()
  stage(poll, linkForwarders)
  await cleanFiles($, poll.items, workspaces)
  return changeOf(poll, items)
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

async function cancel($: EngineInterface, id: string): Promise<{ text: string }> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const item = items.find((one: RabeItem): one is RabeItemOf<'codex'> => one.id === id)
  if (item?.status !== 'running') return { text: `No running Codex job ${id}.` }
  const { claude } = await homes($)
  const installed = parseJson(
    String(
      await $.fs.read(`${claude}/plugins/installed_plugins.json`).then(tally, e => fault(e, '')),
    ),
  )
  const root = str(rec(list(rec(installed?.plugins)[CODEX_PLUGIN])[0]).installPath)
  if (!root) return { text: 'Stop refused: the Codex plugin is not installed.' }
  const { workspaceRoot } = item.detail
  const argv = [
    'node',
    `${root}/scripts/codex-companion.mjs`,
    'cancel',
    item.detail.jobId,
    '--json',
    ...(workspaceRoot ? ['--cwd', workspaceRoot] : []),
  ]
  const result = await $.process
    .run(argv, { env: { CLAUDE_PLUGIN_DATA: `${claude}/${CODEX_DATA}` } })
    .catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  if (result.exitCode !== 0) {
    await write($, held =>
      updateItem(held, id, {
        detail: { stopError: firstLine(result.stderr) || `exit ${result.exitCode}` },
      }),
    )
    return { text: 'Stop refused: the Codex companion could not stop the job.' }
  }
  const now = await $.clock.now()
  // later polls skip the stopped job: its cost stays only while the session
  // file is the one it was priced from
  const { sessionPath, sessionUpdatedAt } = item.detail
  const stat = sessionPath ? await $.fs.stat(sessionPath).catch(() => undefined) : undefined
  const isPriced = stat !== undefined && stat.mtimeMs === sessionUpdatedAt
  await write($, held => {
    const ended = endItem(held, id, 'stopped', now)
    return updateItem(ended, id, {
      detail: { stopError: undefined },
      ...(!isPriced && { costUsd: undefined }),
    })
  })

  return { text: `Stopped codex ${item.detail.jobId}` }
}

export function codex(on: On, file: string, pollers: Pollers): void {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    pollers.push({ name: 'codex', run: items => pollCodex($, file, items), initial: false })
    const started = await next(e)
    await $.command.register({
      name: 'rabe-stop',
      description: 'Stop a background item that Rabe shows, by its id',
      argumentHint: '<item id>',
      immediate: true,
    })

    return started
  })

  on('command.run', { command: 'rabe-stop', args: /^\s*codex:/ }, async ($, e) =>
    cancel($, e.args.trim()),
  )
}
