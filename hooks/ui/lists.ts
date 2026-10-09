import type { RabeEdit, RabeOrder, RabePrevious } from '../../types'
import type { RabeItem, RabeItemKind } from '../model'
import { nextRuns } from '../schedule'
import type { Span } from './cells/grid'
import { C, type Style } from './cells/palette'
import { ago, clockTime, duration, short, tokens, usd } from './format'

export type Group = 'failed' | 'agents' | 'shells' | 'monitors' | 'cron' | 'new'

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'failed', label: 'Failed' },
  { id: 'agents', label: 'Agents' },
  { id: 'shells', label: 'Shells' },
  { id: 'monitors', label: 'Monitors' },
  { id: 'cron', label: 'Cron' },
  { id: 'new', label: 'New' },
]

export const KIND_LABEL: Record<RabeItemKind, string> = {
  agent: 'claude',
  codex: 'codex',
  workflow: 'workflow',
  shell: 'shell',
  monitor: 'monitor',
  cron: 'cron',
}

const RUNNING_GLYPH: Record<RabeItemKind, string> = {
  agent: '◐',
  codex: '◐',
  workflow: '⧉',
  shell: '▶',
  monitor: '◉',
  cron: '⟳',
}

export function glyph(item: RabeItem): string {
  if (item.status === 'failed') return '✗'
  if (item.status === 'done') return '✓'
  if (item.status === 'stopped') return '■'

  return RUNNING_GLYPH[item.kind]
}

export function nextRun(item: RabeItem, now: number): number | undefined {
  if (item.kind !== 'cron') return undefined
  if (item.detail.scheduledFor !== undefined) return item.detail.scheduledFor

  return item.detail.schedule ? nextRuns(item.detail.schedule, now, 1)[0] : undefined
}

// The next run as its clock time: a countdown in m:ss (`15:44`) reads like
// one. A wakeup past its time waits for the session to go idle: `due`.
export function nextAt(item: RabeItem, now: number): string {
  const next = nextRun(item, now)
  if (next === undefined) return 'n/a'

  return next > now ? clockTime(next).slice(0, 5) : 'due'
}

// A shell's port (blue) and a failed shell's exit code (red) follow its title.
export function nameSpans(item: RabeItem, style: Style = {}): Span[] {
  const out: Span[] = [[item.title, style]]
  if (item.kind !== 'shell') return out
  if (item.detail.port !== undefined) out.push([` :${item.detail.port}`, { fg: C.blue }])
  if (item.status === 'failed' && item.detail.exitCode !== undefined) {
    out.push([` exit ${item.detail.exitCode}`, { fg: C.red }])
  }

  return out
}

export function timeLabel(item: RabeItem, now: number): string {
  if (item.status !== 'running') return item.endedAt === undefined ? 'n/a' : ago(now - item.endedAt)
  if (item.kind === 'cron') {
    const at = nextAt(item, now)
    return at === 'n/a' || at === 'due' ? at : `next ${at}`
  }
  if (item.startedAt === undefined) return `≥ ${short(now - item.seenAt)}`

  return duration(now - item.startedAt)
}

export function groupOf(item: RabeItem): Group {
  if (item.status === 'failed') return 'failed'
  if (item.kind === 'shell') return 'shells'
  if (item.kind === 'monitor') return 'monitors'
  if (item.kind === 'cron') return 'cron'

  return 'agents'
}

export function matches(item: RabeItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const d = item.detail as Record<string, unknown>
  const words = [item.title, KIND_LABEL[item.kind], d.command, d.prompt, d.description, d.type]

  return words.some(word => typeof word === 'string' && word.toLowerCase().includes(q))
}

// A Claude agent that only forwarded work to the Codex companion: each tool
// call it made ran the companion, and Rabe linked a job to it. Its row folds
// into the job; an agent that did more, or whose tool count is not known, stays.
export function isForwarder(item: RabeItem, items: readonly RabeItem[]): boolean {
  if (item.kind !== 'agent') return false
  const calls = item.detail.codexCalls?.length ?? 0

  return (
    calls > 0 &&
    item.detail.toolCount === calls &&
    items.some(one => one.kind === 'codex' && one.parentId === item.id)
  )
}

// The items lists show: forwarders fold into their Codex jobs.
export const shown = (items: RabeItem[]): RabeItem[] =>
  items.filter(item => !isForwarder(item, items))

// The forwarder folded into a Codex job: only its first job counts it.
export function forwarderOf(job: RabeItem, items: readonly RabeItem[]): RabeItem | undefined {
  if (job.kind !== 'codex' || !job.parentId) return undefined
  const parent = items.find(one => one.id === job.parentId)
  const first = items.find(one => one.kind === 'codex' && one.parentId === job.parentId)

  return parent && first === job && isForwarder(parent, items) ? parent : undefined
}

const add = (a?: number, b?: number) =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)

// A Codex job's spend with its forwarder's: one piece of work, one cost line.
export function withForwarder(item: RabeItem, items: readonly RabeItem[]): RabeItem {
  const by = forwarderOf(item, items)
  if (!by?.tokens && by?.costUsd === undefined) return item
  const [a, b] = [item.tokens, by.tokens]
  const tokens =
    a && b
      ? {
          input: a.input + b.input,
          output: a.output + b.output,
          ...((a.cached ?? b.cached) !== undefined && { cached: add(a.cached, b.cached) }),
        }
      : (a ?? b)

  return { ...item, tokens, costUsd: add(item.costUsd, by.costUsd) } as RabeItem
}

// Codex jobs follow the agent that started them.
export function nest(list: RabeItem[]): RabeItem[] {
  const isChild = (item: RabeItem) =>
    item.kind === 'codex' && list.some(one => one.kind === 'agent' && one.id === item.parentId)

  return list
    .filter(item => !isChild(item))
    .flatMap(item => [item, ...list.filter(one => isChild(one) && one.parentId === item.id)])
}

const recency = (item: RabeItem) => item.endedAt ?? item.startedAt ?? item.seenAt

export function sortItems(items: RabeItem[]): RabeItem[] {
  return items.toSorted(
    (a, b) =>
      Number(b.status === 'running') - Number(a.status === 'running') || recency(b) - recency(a),
  )
}

// A list that does not reorder under the focus. Without `held` (nobody has
// seen the list yet) it is `sort(list)`; with it, the held ids come first in
// held order, then the others in the order of `list`, which is the order Rabe
// saw them: new items append, and a status change moves nothing.
export function stable<T extends { id: string }>(
  list: T[],
  held: readonly string[] | undefined,
  sort: (list: T[]) => T[],
): T[] {
  if (!held) return sort(list)
  const at = new Map(held.map((id, i) => [id, i]))

  return list.toSorted((a, b) => (at.get(a.id) ?? held.length) - (at.get(b.id) ?? held.length))
}

// The Items tab's groups, failed first. Without `order` each group sorts
// running first, then the newest; with it, a held item stays in the group and
// place `orderOf` gave it, and items Rabe saw since go to NEW, the last group,
// in the order Rabe saw them: a row never appears above another.
export function grouped(
  items: RabeItem[],
  order?: RabeOrder,
): { id: Group; label: string; items: RabeItem[] }[] {
  const of = (item: RabeItem): Group =>
    order ? (GROUPS.find(group => order[group.id]?.includes(item.id))?.id ?? 'new') : groupOf(item)

  return GROUPS.map(group => ({
    ...group,
    items: stable(
      items.filter(item => of(item) === group.id),
      order && (order[group.id] ?? []),
      group.id === 'agents' ? list => nest(sortItems(list)) : sortItems,
    ),
  })).filter(group => group.items.length > 0)
}

const start = (item: RabeItem) => item.startedAt ?? item.seenAt

export function byStart(items: RabeItem[]): RabeItem[] {
  return items.toSorted((a, b) => start(a) - start(b))
}

// Who changed files: an agent, a Codex job or the main session (no item).
export type Editor = { id: string; title: string; tree?: string; root?: string; item?: RabeItem }

export type Touched = {
  id: string
  path: string
  rel: string
  by: Editor[]
  last: Editor
  edits: number
  at: number
  first: number
  hows: string[]
  isDeleted: boolean
  isConflict: boolean
}

function relative(path: string, editor: Editor): string {
  const { root } = editor

  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function howOf(edit: RabeEdit): string {
  if (edit.via === 'shell') return 'via shell'
  if (edit.via === 'codex') return `codex ${edit.change ?? 'update'}`

  return edit.via ?? 'edit'
}

type Edits = { editor: Editor; edits: RabeEdit[] }

function editorsOf(items: RabeItem[], main: RabeEdit[], cwd?: string): Edits[] {
  const own = items.flatMap((item): Edits[] => {
    if (item.kind === 'agent') {
      const { worktreePath, cwd: root } = item.detail
      const editor = {
        id: item.id,
        title: item.title,
        tree: worktreePath,
        root: worktreePath ?? root,
        item,
      }
      return [{ editor, edits: item.detail.edits ?? [] }]
    }
    if (item.kind === 'codex') {
      const editor = { id: item.id, title: item.title, root: item.detail.workspaceRoot, item }
      return [{ editor, edits: item.detail.edits ?? [] }]
    }
    return []
  })

  return [...own, { editor: { id: 'main', title: 'main session', root: cwd }, edits: main }]
}

// The files changed by agents (Edit and Write calls the engine ran, not the
// calls a turn asks for), Codex jobs (file changes) and the main session, and
// the files shell commands of each wrote (a guess), in the order they were
// first changed. `by` lists the editors in the order they first changed it,
// `last` the latest one, `hows` how, `first` and `at` the first and the latest
// change times. Two editors of one absolute path are a conflict; a relative
// path (a shell write whose cwd is not known) is none.
export function touched(items: RabeItem[], main: RabeEdit[] = [], cwd?: string): Touched[] {
  const edits = editorsOf(items, main, cwd)
    .flatMap(({ editor, edits: list }) => list.map(edit => ({ editor, edit })))
    .toSorted((a, b) => a.edit.at - b.edit.at)
  const files = new Map<string, Touched>()
  for (const { editor, edit } of edits) {
    const { path, at } = edit
    const file = files.get(path) ?? {
      id: `file:${path}`,
      path,
      rel: relative(path, editor),
      by: [],
      last: editor,
      edits: 0,
      at,
      first: at,
      hows: [],
      isDeleted: false,
      isConflict: false,
    }
    if (!file.by.includes(editor)) file.by.push(editor)
    const how = howOf(edit)
    if (!file.hows.includes(how)) file.hows.push(how)
    file.last = editor
    file.edits += 1
    file.at = at
    file.isDeleted = edit.change === 'delete'
    file.isConflict = file.by.length > 1 && path.startsWith('/')
    files.set(path, file)
  }

  return [...files.values()]
}

// Conflicts (two editors) first, then the latest edit first.
export function byConflict(files: Touched[]): Touched[] {
  return files.toSorted((a, b) => Number(b.isConflict) - Number(a.isConflict) || b.at - a.at)
}

// Shells and monitors an agent started sit under that agent (see `byParent`).
export const FAMILIES: Group[] = ['shells', 'monitors']

// The order the pane shows when it opens: each group sorted (shells and
// monitors in their families), the Cost tab by tokens, the Timeline by start,
// the Effects files by `byConflict` and its ports (the shells that run with
// one). Held in `rabe.order` until the next open.
export function orderOf(all: RabeItem[], edits: RabeEdit[] = []): RabeOrder {
  const ids = (list: RabeItem[]) => list.map(item => item.id)
  const items = shown(all)

  return {
    ports: ids(
      items.filter(
        item =>
          item.kind === 'shell' && item.detail.port !== undefined && item.status === 'running',
      ),
    ),
    ...Object.fromEntries(
      grouped(items).map(group => [
        group.id,
        ids(
          FAMILIES.includes(group.id)
            ? byParent(group.items, items).flatMap(family => family.items)
            : group.items,
        ),
      ]),
    ),
    cost: ids(byTokens(items.map(item => withForwarder(item, all)))),
    timeline: ids(byStart(items)),
    files: byConflict(touched(all, edits)).map(file => file.id),
  }
}

export type Family = { id: string; parent?: RabeItem; title: string; items: RabeItem[] }

// Shells and monitors by who started them: the main session's first (title
// ''), then one block per agent in the order of `list`. A workflow agent reads
// "run › agent"; an agent Rabe no longer holds "agent n/a".
export function byParent(list: RabeItem[], items: RabeItem[]): Family[] {
  const blocks: Family[] = [{ id: '', title: '', items: [] }]
  for (const item of list) {
    const id = item.parentId ?? ''
    let block = blocks.find(one => one.id === id)
    if (!block) {
      const parent = items.find(one => one.id === id)
      const run = parent && items.find(one => one.id === parent.parentId && one.kind === 'workflow')
      const title = !parent ? 'agent n/a' : run ? `${run.title} › ${parent.title}` : parent.title
      block = { id, ...(parent && { parent }), title, items: [] }
      blocks.push(block)
    }
    block.items.push(item)
  }

  return blocks.filter(block => block.items.length > 0)
}

export function groupNote(id: Group, items: RabeItem[]): string {
  if (id === 'failed') return ''
  if (id === 'agents') {
    return (['agent', 'codex', 'workflow'] as const)
      .map(kind => [items.filter(item => item.kind === kind).length, KIND_LABEL[kind]] as const)
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}`)
      .join(' · ')
  }
  const running = items.filter(item => item.status === 'running').length
  const ended = items.length - running

  return [running && `${running} running`, ended && `${ended} ended`].filter(Boolean).join(' · ')
}

export function children(items: RabeItem[], id: string): RabeItem[] {
  return items.filter(item => item.parentId === id)
}

export type PhaseState = 'done' | 'running' | 'failed' | 'waiting'

export function phases(
  items: RabeItem[],
  flow: RabeItem,
): { name: string; state: PhaseState; agents: RabeItem[] }[] {
  if (flow.kind !== 'workflow') return []
  const agents = children(items, flow.id)
  const names = flow.detail.phases ?? []
  const seen = agents.map(a => (a.kind === 'agent' ? a.detail.workflowPhase : undefined) ?? 'n/a')
  const all = [
    ...names,
    ...seen.filter((one, i) => !names.includes(one) && seen.indexOf(one) === i),
  ]

  return all.map(phase => {
    const list = agents.filter((_, i) => seen[i] === phase)
    const state: PhaseState =
      list.length === 0
        ? 'waiting'
        : list.some(a => a.status === 'running')
          ? 'running'
          : list.every(a => a.status === 'done')
            ? 'done'
            : 'failed'
    return { name: phase, state, agents: list }
  })
}

export function phaseProgress(items: RabeItem[], flow: RabeItem): string {
  const list = phases(items, flow)
  const at = list.findLastIndex(phase => phase.state !== 'waiting')
  if (at === -1) return list.length ? `0/${list.length}` : 'n/a'

  return `${list[at]?.name} ${at + 1}/${list.length}`
}

export type Totals = {
  usd?: number
  tokens: number
  unknown: number
  claude?: number
  codex?: number
}

const plus = (sum: number | undefined, value: number | undefined) =>
  value === undefined ? sum : (sum ?? 0) + value

export function totals(items: RabeItem[]): Totals {
  const out: Totals = { tokens: 0, unknown: 0 }
  for (const item of items) {
    if (item.kind !== 'agent' && item.kind !== 'codex') continue
    if (!item.tokens) out.unknown += 1
    out.tokens += item.tokens ? item.tokens.input + item.tokens.output : 0
    if (item.costUsd === undefined) continue
    out.usd = plus(out.usd, item.costUsd)
    if (item.kind === 'agent') out.claude = plus(out.claude, item.costUsd)
    else out.codex = plus(out.codex, item.costUsd)
  }

  return out
}

export const cost = (n: number | undefined) => (n === undefined ? 'n/a' : usd(n))

export const tokenSum = (item: RabeItem) =>
  item.tokens ? item.tokens.input + item.tokens.output : -1

export function byTokens(items: RabeItem[]): RabeItem[] {
  return items
    .filter(item => item.kind === 'agent' || item.kind === 'codex')
    .toSorted((a, b) => tokenSum(b) - tokenSum(a))
}

export function share(items: RabeItem[], item: RabeItem): string {
  const all = totals(items).tokens
  const own = tokenSum(item)

  return all > 0 && own >= 0 ? `${Math.round((own / all) * 100)}%` : 'n/a'
}

// `session` is the session's cost as `/cost` totals it; it wins over the sum
// of the items, which misses every worker without a dollar amount.
export function costLine(items: RabeItem[], session?: number): string | undefined {
  const sum = totals(items)
  if (sum.tokens === 0) return undefined
  const top = byTokens(items)[0]
  const topText = top?.tokens ? ` · top: ${top.title} ${tokens(tokenSum(top))}` : ''

  const known = session ?? sum.usd
  const dollars = known === undefined ? 'cost n/a' : `≈ ${usd(known)}`

  return `${dollars} · ${tokens(sum.tokens)} tok${topText}`
}

export type BandRow = {
  glyph: string
  kind: RabeItemKind | 'failed'
  label: string
  names: Span[][]
}

const isRunning = (kind: RabeItemKind) => (item: RabeItem) =>
  item.kind === kind && item.status === 'running'

// Running shells or monitors as the Items tab groups them: the main
// session's first, then each agent's after its dim name.
function familyNames(items: RabeItem[], kind: 'shell' | 'monitor'): Span[][] {
  return byParent(items.filter(isRunning(kind)), items).flatMap(family =>
    family.items.map((item): Span[] =>
      family.id === ''
        ? nameSpans(item)
        : [[`${family.title} › `, { fg: C.dim }], ...nameSpans(item)],
    ),
  )
}

export function bandRows(items: RabeItem[], now: number): BandRow[] {
  const dim = { fg: C.dim }
  const run = (item: RabeItem): Span[] => [
    [item.title],
    [item.startedAt === undefined ? '' : ` ${short(now - item.startedAt)}`, dim],
  ]
  const failed = items.filter(
    item => item.status === 'failed' && now - (item.endedAt ?? item.seenAt) < 10 * 60_000,
  )
  const rows: BandRow[] = [
    { glyph: '✗', kind: 'failed', label: 'failed', names: failed.map(item => nameSpans(item)) },
    {
      glyph: '◐',
      kind: 'agent',
      label: 'claude',
      names: shown(items).filter(isRunning('agent')).map(run),
    },
    { glyph: '◐', kind: 'codex', label: 'codex', names: items.filter(isRunning('codex')).map(run) },
    {
      glyph: '⧉',
      kind: 'workflow',
      label: 'workflow',
      names: items
        .filter(isRunning('workflow'))
        .map(flow => [
          [flow.title],
          [` · ${phaseProgress(items, flow)} · ${children(items, flow.id).length} agents`, dim],
        ]),
    },
    {
      glyph: '▶',
      kind: 'shell',
      label: 'shells',
      names: familyNames(items, 'shell'),
    },
    {
      glyph: '◉',
      kind: 'monitor',
      label: 'watch',
      names: familyNames(items, 'monitor'),
    },
    {
      glyph: '⟳',
      kind: 'cron',
      label: 'cron',
      names: items
        .filter(isRunning('cron'))
        .map(item => [[item.title], [' · next ', dim], [nextAt(item, now), { fg: C.bright }]]),
    },
  ]

  return rows.filter(row => row.names.length > 0)
}

const width = (list: Span[]) => list.reduce((n, [text]) => n + text.length, 0)

// Names joined with a dim " · " until `width`, then a dim "+N" for the rest.
export function joinFit(names: Span[][], max: number): Span[] {
  const sep: Span = [' · ', { fg: C.dim }]
  let out: Span[] = []
  for (const [i, one] of names.entries()) {
    const next = i === 0 ? one : [...out, sep, ...one]
    const rest = names.length - i - 1
    if (i > 0 && width(next) + (rest ? ` +${rest}`.length : 0) > max) {
      return [...out, [` +${names.length - i}`, { fg: C.dim }]]
    }
    out = next
  }

  return out
}

export type TreeLine = { prefix: string; item: RabeItem }

export function tree(items: RabeItem[]): TreeLine[] {
  const ids = new Set(items.map(item => item.id))
  const out: TreeLine[] = []
  const walk = (list: RabeItem[], indent: string) => {
    for (const [i, item] of list.entries()) {
      const isLast = i === list.length - 1
      out.push({ prefix: `${indent}${isLast ? '└─ ' : '├─ '}`, item })
      walk(children(items, item.id), `${indent}${isLast ? '   ' : '│  '}`)
    }
  }
  walk(
    items.filter(item => !item.parentId || !ids.has(item.parentId)),
    '',
  )

  return out
}

export function bar(from: number, to: number, start: number, end: number, width: number): string {
  const span = Math.max(1, end - start)
  const a = Math.min(width - 1, Math.max(0, Math.floor(((from - start) / span) * width)))
  const b = Math.max(a + 1, Math.min(width, Math.ceil(((to - start) / span) * width)))

  return `${' '.repeat(a)}${'█'.repeat(b - a)}${' '.repeat(width - b)}`
}

export function worktrees(
  items: RabeItem[],
): { name: string; branch: string; items: RabeItem[] }[] {
  const out = new Map<string, { name: string; branch: string; items: RabeItem[] }>()
  for (const item of items) {
    if (item.kind !== 'agent' || !item.detail.worktreePath) continue
    const path = item.detail.worktreePath
    const entry = out.get(path) ?? {
      name: path.includes('/.claude/')
        ? path.slice(path.indexOf('.claude/'))
        : (path.split('/').filter(Boolean).at(-1) ?? path),
      branch: item.detail.worktreeBranch ?? 'n/a',
      items: [],
    }
    entry.items.push(item)
    out.set(path, entry)
  }

  return [...out.values()]
}

// What the next session in this project shows of this one.
export function previousOf(
  items: RabeItem[],
  endedAt: number,
  usage: { startedAt?: number; usd?: number },
  sessionId?: string,
): RabePrevious {
  const counts: RabePrevious['counts'] = {}
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1

  return {
    ...(sessionId && { sessionId }),
    endedAt,
    startedAt: usage.startedAt,
    counts,
    tokens: totals(items).tokens,
    usd: usage.usd,
    failed: items.filter(item => item.status === 'failed').map(item => item.title),
  }
}
