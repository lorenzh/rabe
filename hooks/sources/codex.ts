import type { EngineInterface, On } from 'claude-code'

import type { RabeCodexStep, RabeEdit, RabeTokens } from '../../types'
import {
  clip,
  type EndStatus,
  itemId,
  type NewItem,
  type RabeItem,
  type RabeItemOf,
} from '../model'
import { addItem, type Change, commit, endItem, prune } from '../registry'
import { shellWrites } from '../writes'

const POLL_MS = 2000
const CODEX_DATA = 'plugins/data/codex-openai-codex'
const CODEX_PLUGIN = 'codex@openai-codex'
const MAX_READ = 4 * 1024 * 1024
const TAIL_LINES = 200
const MAX_STEPS = 50
const MAX_TEXT = 300
const MAX_EDITS = 100
const CHANGES = ['add', 'update', 'delete'] as const
const DAY = 24 * 60 * 60 * 1000

type Rec = Record<string, unknown>

export type CodexJob = Rec & { id: string }

export type Rollout = {
  model?: string
  effort?: string
  sandbox?: string
  prompt?: string
  tokens?: RabeTokens
  commandCount: number
  steps: RabeCodexStep[]
  edits?: RabeEdit[]
}

export type CodexSession = {
  path?: string
  updatedAt?: number
  isMissing?: boolean
  isPartial?: boolean
  rollout?: Rollout
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

export function parseRollout(text: string, home?: string): Rollout {
  const out: Rollout = { commandCount: 0, steps: [] }
  const edits: RabeEdit[] = []
  const pending = new Map<string, RabeCodexStep>()
  for (const raw of text.split('\n')) {
    const record = parseJson(raw)
    if (!record) continue
    const payload = rec(record.payload)
    if (record.type === 'turn_context') {
      const settings = rec(rec(payload.collaboration_mode).settings)
      out.model = str(payload.model) ?? str(settings.model) ?? out.model
      out.effort = str(payload.effort) ?? str(settings.reasoning_effort) ?? out.effort
      out.sandbox = str(rec(payload.sandbox_policy).type) ?? out.sandbox
    } else if (record.type === 'event_msg' && payload.type === 'token_count') {
      const usage = rec(rec(payload.info).total_token_usage)
      const input = num(usage.input_tokens)
      const output = num(usage.output_tokens)
      if (input !== undefined && output !== undefined) {
        out.tokens = defined({ input, output, cached: num(usage.cached_input_tokens) })
      }
    } else if (record.type === 'event_msg' && payload.type === 'item_completed') {
      const item = rec(payload.item)
      const at = num(payload.completed_at_ms) ?? (Date.parse(str(record.timestamp) ?? '') || 0)
      if (item.type === 'UserMessage') out.prompt ??= str(texts(item.content, 'text'))
      if (item.type === 'FileChange' && item.status === 'completed') {
        edits.push(...fileChanges(item.changes, at))
      }
      if (item.type === 'CommandExecution' && item.exit_code === 0) {
        for (const { path, isDeleted } of shellWrites(
          shellLine(item.command),
          str(item.cwd),
          home,
        )) {
          edits.push({ path, at, via: 'shell', ...(isDeleted && { change: 'delete' as const }) })
        }
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
        pending.set(String(payload.call_id), step)
        out.steps.push(step)
      } else if (payload.type === 'custom_tool_call_output') {
        const step = pending.get(String(payload.call_id))
        out.steps = out.steps.filter(one => one !== step)
      }
    }
  }
  out.steps = out.steps.slice(-MAX_STEPS)
  if (edits.length) out.edits = edits.slice(-MAX_EDITS)

  return defined(out)
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

export function codexItem(job: CodexJob, session: CodexSession | undefined): NewItem {
  const rollout = session?.rollout
  // an unchanged session file is not parsed again; the held item keeps what it gave
  const request = session?.path && !rollout ? {} : rec(job.request)

  return defined({
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
    const entries = await $.fs.list(dir).catch(() => [])
    const found = entries.find(entry => entry.name.endsWith(`-${threadId}.jsonl`))
    if (found) return `${dir}/${found.name}`
  }

  return undefined
}

async function readSession(
  $: EngineInterface,
  codexHome: string,
  job: CodexJob,
  held: RabeItemOf<'codex'> | undefined,
): Promise<CodexSession | undefined> {
  const threadId = str(job.threadId)
  if (!threadId) return undefined
  const path =
    held?.detail.sessionPath ??
    (await findRollout($, codexHome, threadId, jobStart(job) ?? (await $.clock.now())))
  const stat = path ? await $.fs.stat(path).catch(() => undefined) : undefined
  if (!path || !stat) return jobEnd(job.status) ? { isMissing: true } : undefined
  const updatedAt = stat.mtimeMs
  if (updatedAt === held?.detail.sessionUpdatedAt) return { path, updatedAt }
  // no updatedAt on failure, so the next poll tries again
  const home = await $.env.get('HOME')
  if (stat.size <= MAX_READ) {
    const text = await $.fs.read(path).catch(() => undefined)

    return text === undefined
      ? { path }
      : { path, updatedAt, rollout: parseRollout(String(text), home) }
  }
  const head = await $.process
    .run(['grep', '-m', '2', '-E', '"type":"(turn_context|UserMessage)"', path])
    .catch(() => undefined)
  const tail = await $.process.run(['tail', '-n', String(TAIL_LINES), path]).catch(() => undefined)
  if (!head || !tail || tail.exitCode !== 0) return { path }

  return {
    path,
    updatedAt,
    isPartial: true,
    rollout: parseRollout(`${head.stdout}\n${tail.stdout}`, home),
  }
}

async function refresh(
  $: EngineInterface,
  sessionId: string,
  codexHome: string,
  jobPath: string,
  entry: CodexJob,
  items: RabeItem[],
): Promise<void> {
  const file = parseJson(String(await $.fs.read(jobPath).catch(() => '')))
  const job: CodexJob = { ...entry, ...file, id: entry.id }
  if (job.sessionId !== sessionId) return
  const end = jobEnd(job.status)
  const now = await $.clock.now()
  const endedAt = Date.parse(str(job.completedAt) ?? '') || now
  const change = (item: NewItem) => (list: RabeItem[]) => {
    const added = addItem(list, item, now)

    return end ? endItem(added, item.id, end, endedAt) : added
  }
  const held = items.find((one): one is RabeItemOf<'codex'> => one.id === itemId('codex', job.id))
  // a finished job the cap would drop again: its session file is not read
  if (!held && commit(items, change(codexItem(job, undefined))) === undefined) return
  const session = await readSession($, codexHome, job, held)
  await write($, change(codexItem(job, session)))
}

async function poll($: EngineInterface): Promise<void> {
  const { claude, codex } = await homes($)
  const stateRoot = `${claude}/${CODEX_DATA}/state`
  const sessionId = await $.session.id()
  const { startedAt: since } = await $.session.usage()
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  // ponytail: one stat per workspace folder per poll; keep a folder list in $.state if there are hundreds
  for (const dir of await $.fs.list(stateRoot).catch(() => [])) {
    if (dir.kind !== 'dir') continue
    const statePath = `${stateRoot}/${dir.name}/state.json`
    const stat = await $.fs.stat(statePath).catch(() => undefined)
    if (!stat || stat.mtimeMs < since) continue
    const state = parseJson(String(await $.fs.read(statePath).catch(() => '')))
    for (const entry of list(state?.jobs).map(rec)) {
      const id = str(entry.id)
      // the plugin's state.json can hold a bare status patch; its job file has the session
      if (!id || (entry.sessionId !== undefined && entry.sessionId !== sessionId)) continue
      const held = items.find((one): one is RabeItemOf<'codex'> => one.id === itemId('codex', id))
      if (held && held.status !== 'running') continue
      await refresh(
        $,
        sessionId,
        codex,
        `${stateRoot}/${dir.name}/jobs/${id}.json`,
        { ...entry, id },
        items,
      ).catch(() => undefined)
    }
  }
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
    String(await $.fs.read(`${claude}/plugins/installed_plugins.json`).catch(() => '')),
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
    return { text: `Stop refused: ${firstLine(result.stderr) || `exit ${result.exitCode}`}` }
  }
  const now = await $.clock.now()
  await write($, held => endItem(held, id, 'stopped', now))

  return { text: `Stopped codex ${item.title}` }
}

export function codex(on: On): void {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'rabe-stop',
      description: 'Stop a background item that Rabe shows, by its id',
      argumentHint: '<item id>',
      immediate: true,
    })
    $.clock.every(POLL_MS, () => {
      poll($).catch(() => undefined)
    })

    return started
  })

  on('command.run', { command: 'rabe-stop', args: /^\s*codex:/ }, async ($, e) =>
    cancel($, e.args.trim()),
  )
}
