import type { EngineInterface, On } from 'claude-code'

import type { RabeCodexStep, RabeTokens } from '../../types'
import { type EndStatus, itemId, type NewItem, type RabeItem, type RabeItemOf } from '../model'
import { addItem, type Change, commit, endItem } from '../registry'

const POLL_MS = 2000
const CODEX_DATA = 'plugins/data/codex-openai-codex'
const CODEX_PLUGIN = 'codex@openai-codex'
const MAX_READ = 4 * 1024 * 1024
const TAIL_LINES = 200
const MAX_STEPS = 50
const MAX_TEXT = 300
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

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text
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

export function parseRollout(text: string): Rollout {
  const out: Rollout = { commandCount: 0, steps: [] }
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
      if (item.type === 'UserMessage') out.prompt ??= str(texts(item.content, 'text'))
      if (item.type === 'CommandExecution') {
        out.commandCount += 1
        out.steps.push(
          defined({
            kind: 'command' as const,
            text: clip(shellLine(item.command)),
            exitCode: num(item.exit_code),
            lines: lineCount(item.aggregated_output),
          }),
        )
      }
    } else if (record.type === 'response_item') {
      if (payload.type === 'message' && payload.role === 'assistant') {
        const message = texts(payload.content, 'output_text')
        if (message) out.steps.push({ kind: 'message', text: clip(message) })
      } else if (payload.type === 'reasoning') {
        const summary = list(payload.summary)
          .map(part => str(rec(part).text))
          .filter(Boolean)
          .join('\n')
        if (summary) out.steps.push({ kind: 'reasoning', text: clip(summary) })
      } else if (payload.type === 'custom_tool_call') {
        const step: RabeCodexStep = {
          kind: 'command',
          text: clip(pendingCommand(payload.input)),
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
  const request = rec(job.request)
  const rollout = session?.rollout

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
    }),
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

async function homes($: EngineInterface): Promise<{ claude: string; codex: string }> {
  const home = (await $.env.get('HOME')) ?? ''

  return {
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
  if (stat.size <= MAX_READ) {
    const text = String(await $.fs.read(path))

    return { path, updatedAt, rollout: parseRollout(text) }
  }
  const head = await $.process.run([
    'grep',
    '-m',
    '2',
    '-E',
    '"type":"(turn_context|UserMessage)"',
    path,
  ])
  const tail = await $.process.run(['tail', '-n', String(TAIL_LINES), path])

  return {
    path,
    updatedAt,
    isPartial: true,
    rollout: parseRollout(`${head.stdout}\n${tail.stdout}`),
  }
}

async function refresh(
  $: EngineInterface,
  sessionId: string,
  codexHome: string,
  jobPath: string,
  entry: CodexJob,
  held: RabeItemOf<'codex'> | undefined,
): Promise<void> {
  const file = parseJson(String(await $.fs.read(jobPath).catch(() => '')))
  const job: CodexJob = { ...entry, ...file, id: entry.id }
  if (job.sessionId !== sessionId) return
  const session = await readSession($, codexHome, job, held)
  const item = codexItem(job, session)
  const end = jobEnd(job.status)
  const now = await $.clock.now()
  const endedAt = Date.parse(str(job.completedAt) ?? '') || now
  await write($, items => {
    const added = addItem(items, item, now)

    return end ? endItem(added, item.id, end, endedAt) : added
  })
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
        held,
      )
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
