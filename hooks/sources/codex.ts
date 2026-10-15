import type { EngineInterface, FsStat, On } from 'claude-code'

import type { RabeDiff, RabeEdit } from '../../types'
import { keep } from '../diffs'
import { linkForwarders } from '../forwarders'
import { fault, type Pollers, skipped, tally } from '../loop'
import { itemId, type NewItem, type RabeItem, type RabeItemOf } from '../model'
import { codexUsd, type Prices, parsePrices, withOverride } from '../prices'
import {
  byteLength,
  cursorOf,
  inodeOf,
  isRecord,
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
import { MAX_EDITS } from './agent-items'
import {
  advanceRollout,
  type CodexJob,
  type CodexSession,
  codexItem,
  jobEnd,
  jobStart,
  jobStop,
  list,
  parseJson,
  parseRollout,
  type Rec,
  type Rollout,
  rec,
  rolloutCursor,
  str,
} from './codex-data'

export { advanceRollout, codexItem, jobEnd, parseRollout } from './codex-data'

const CODEX_DATA = 'plugins/data/codex-openai-codex'
const CODEX_PLUGIN = 'codex@openai-codex'
const MAX_READ = 4 * 1024 * 1024
const RUN_MS = 5000
const DAY = 24 * 60 * 60 * 1000
const LATE_MS = 2000
const LOOK_MS = 1000

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

// The file diffs of one parse, kept under the job's item id (see `keep`).
async function recordDiffs(
  $: EngineInterface,
  id: string,
  diffs: RabeDiff[] | undefined,
): Promise<void> {
  if (!diffs?.length) return
  for (;;) {
    // A job the list no longer holds leaves no diff behind.
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    if (!items.some(one => one.id === id)) return
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'diffs' })
    const next = keep(value, id, diffs)
    if (next === value) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'diffs' }, next, {
      ifVersion: version,
    })
    // An eviction may have finished its cleanup after the check above: drop what this write left.
    if (isSet) return forget($, [id])
  }
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
  const { value: savedValue, version } = await $.state.get({ plugin: 'rabe', key: 'rollouts' })
  const value = restored(savedValue)
  const key = itemId('codex', job.id)
  const entry = value[key]
  const saved =
    entry &&
    typeof entry.path === 'string' &&
    cursorOf(entry.cursor) &&
    rolloutCursor(entry.parser) &&
    typeof entry.usd === 'number' &&
    Number.isFinite(entry.usd) &&
    (['isUnpriced', 'hasRequests', 'hasSkipped'] as const).every(
      key => typeof entry[key] === 'boolean',
    )
      ? entry
      : undefined
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
    (entry === undefined && updatedAt === held?.detail.sessionUpdatedAt)
  ) {
    skipped()
    if (!previous) return { path, updatedAt }
    const isPartial =
      previous.hasSkipped || (previous.cursor.offset < stat.size && !previous.cursor.partial)
    return {
      path,
      updatedAt,
      rollout: previous.parser.out,
      isPartial,
      usd: isPartial || previous.isUnpriced || !previous.hasRequests ? undefined : previous.usd,
    }
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
    await recordDiffs($, itemId('codex', job.id), rollout.diffs)
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
    if (result.exitCode !== 0) {
      fault(`tail exited with code ${result.exitCode}`)
      return { path }
    }
    text = tally(result.stdout)
    truncated = result.isStdoutTruncated
  }
  const chunk = readChunk(text, truncated, true, reset ? false : previous?.cursor.isDiscarding)
  if (truncated && chunk.bytes === 0) return { path }
  const parser = advanceRollout(
    chunk.text,
    reset ? undefined : previous?.parser,
    home,
    jobStart(job),
    until,
  )
  const rollout = await confirmed($, parser.out, looks)
  await recordDiffs($, key, rollout.diffs)
  const { diffs: _diffs, ...kept } = rollout
  parser.out = { ...kept, requests: [] }
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
  const { value: savedValue, version } = await $.state.get({ plugin: 'rabe', key: 'codexFiles' })
  const value = restored(savedValue)
  const held = value[path]
  if (isRecord(held?.data) && unchanged(stat, held)) {
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
    const { value: savedValue, version } = await $.state.get({ plugin: 'rabe', key: 'rollouts' })
    const value = restored(savedValue)
    const { value: current = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, Object.keys(value), [...items, ...current])
    if (next === value) break
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'rollouts' }, next, {
      ifVersion: version,
    })
    if (isSet) break
  }
  for (;;) {
    const { value: savedValue, version } = await $.state.get({ plugin: 'rabe', key: 'codexFiles' })
    const value = restored(savedValue)
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
            list(rec(entry?.data).jobs).some(job =>
              ids.has(itemId('codex', str(rec(job).id) ?? '')),
            )
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
  const { value } = await $.state.get({ plugin: 'rabe', key: 'rollouts' })
  const cursors = restored(value)
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
      const cursor = cursorOf(cursors[itemId('codex', id)]?.cursor)
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

export const STOP_USAGE =
  'Usage: /rabe-stop codex:<job id>. Use the Codex job id shown in Rabe, not the thread id. To stop other items, use x in the pane.'

export function codex(on: On, file: string, pollers: Pollers): void {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    pollers.push({ name: 'codex', run: items => pollCodex($, file, items), initial: false })
    const started = await next(e)
    await $.command.register({
      name: 'rabe-stop',
      description: 'Stop a running Codex job that Rabe shows, by its job id',
      argumentHint: 'codex:<job id>',
      immediate: true,
    })

    return started
  })

  on('command.run', { command: 'rabe-stop' }, async ($, e) =>
    /^\s*codex:\S/.test(e.args) ? cancel($, e.args.trim()) : { text: STOP_USAGE },
  )
}
