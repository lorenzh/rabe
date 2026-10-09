import type { RabeOrder, RabePrevious } from '../../types'
import type { RabeItem, RabeItemKind, RabeItemOf } from '../model'
import { nextRuns } from '../schedule'
import type { Span } from './cells/grid'
import { C, type Style } from './cells/palette'
import { ago, countdown, duration, short, tokens, usd } from './format'

export type Group = 'failed' | 'agents' | 'shells' | 'monitors' | 'cron'

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'failed', label: 'Failed' },
  { id: 'agents', label: 'Agents' },
  { id: 'shells', label: 'Shells' },
  { id: 'monitors', label: 'Monitors' },
  { id: 'cron', label: 'Cron' },
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
    const next = nextRun(item, now)
    return next === undefined ? 'n/a' : `next ${countdown(next - now)}`
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

// The group an item keeps while an order is held: a held item stays where it
// was; a new one goes by its kind, since its status may change.
function heldGroup(item: RabeItem, order: RabeOrder): Group {
  const held = GROUPS.find(group => order[group.id]?.includes(item.id))?.id
  if (held) return held

  return groupOf({ ...item, status: 'running' } as RabeItem)
}

// The Items tab's groups, failed first. Without `order` each group sorts
// running first, then the newest; with it, rows stay where `orderOf` put them.
export function grouped(
  items: RabeItem[],
  order?: RabeOrder,
): { id: Group; label: string; items: RabeItem[] }[] {
  const of = (item: RabeItem) => (order ? heldGroup(item, order) : groupOf(item))

  return GROUPS.map(group => ({
    ...group,
    items: stable(
      items.filter(item => of(item) === group.id),
      order?.[group.id],
      sortItems,
    ),
  })).filter(group => group.items.length > 0)
}

const start = (item: RabeItem) => item.startedAt ?? item.seenAt

export function byStart(items: RabeItem[]): RabeItem[] {
  return items.toSorted((a, b) => start(a) - start(b))
}

type Agent = RabeItemOf<'agent'>
export type Touched = {
  id: string
  path: string
  rel: string
  by: Agent[]
  last: Agent
  edits: number
  at: number
}

function relative(path: string, agent: Agent): string {
  const root = agent.detail.worktreePath ?? agent.detail.cwd

  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

// The files agents edited, from the Edit and Write calls the engine ran for
// them (a turn's tool calls are only asked for and may be refused), in the
// order they were first edited. `by` lists the editors in the order they
// first edited, `last` the latest one.
export function touched(items: RabeItem[]): Touched[] {
  const edits = items
    .flatMap(item => (item.kind === 'agent' ? [item] : []))
    .flatMap(agent => (agent.detail.edits ?? []).map(edit => ({ agent, ...edit })))
    .toSorted((a, b) => a.at - b.at)
  const files = new Map<string, Touched>()
  for (const { agent, path, at } of edits) {
    const file = files.get(path) ?? {
      id: `file:${path}`,
      path,
      rel: relative(path, agent),
      by: [],
      last: agent,
      edits: 0,
      at,
    }
    if (!file.by.includes(agent)) file.by.push(agent)
    file.last = agent
    file.edits += 1
    file.at = at
    files.set(path, file)
  }

  return [...files.values()]
}

// Conflicts (two editors) first, then the latest edit first.
export function byConflict(files: Touched[]): Touched[] {
  return files.toSorted((a, b) => Number(b.by.length > 1) - Number(a.by.length > 1) || b.at - a.at)
}

// The order the pane shows when it opens: each group sorted, the Cost tab by
// tokens, the Timeline by start, the Effects files by `byConflict`. Held in
// `rabe.order` until the next open.
export function orderOf(items: RabeItem[]): RabeOrder {
  const ids = (list: RabeItem[]) => list.map(item => item.id)

  return {
    ...Object.fromEntries(grouped(items).map(group => [group.id, ids(group.items)])),
    cost: ids(byTokens(items)),
    timeline: ids(byStart(items)),
    files: byConflict(touched(items)).map(file => file.id),
  }
}

export type Family = { id: string; parent?: RabeItem; title: string; items: RabeItem[] }

// Shells and monitors by who started them: the main session's first (title
// ''), then one block per agent in the order of `list`. A workflow agent reads
// "run › agent"; an agent Rabe no longer holds "agent n/a".
export function byParent(list: RabeItem[], items: RabeItem[]): Family[] {
  const blocks = new Map<string, Family>([['', { id: '', title: '', items: [] }]])
  for (const item of list) {
    const id = item.parentId ?? ''
    let block = blocks.get(id)
    if (!block) {
      const parent = items.find(one => one.id === id)
      const run = parent && items.find(one => one.id === parent.parentId && one.kind === 'workflow')
      const title = !parent ? 'agent n/a' : run ? `${run.title} › ${parent.title}` : parent.title
      block = { id, ...(parent && { parent }), title, items: [] }
      blocks.set(id, block)
    }
    block.items.push(item)
  }

  return [...blocks.values()].filter(block => block.items.length > 0)
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
      names: items.filter(isRunning('agent')).map(run),
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
      names: items.filter(isRunning('shell')).map(item => nameSpans(item)),
    },
    {
      glyph: '◉',
      kind: 'monitor',
      label: 'watch',
      names: items.filter(isRunning('monitor')).map(item => nameSpans(item)),
    },
    {
      glyph: '⟳',
      kind: 'cron',
      label: 'cron',
      names: items.filter(isRunning('cron')).map(item => {
        const next = nextRun(item, now)
        return [
          [item.title],
          [' · next ', dim],
          [next === undefined ? 'n/a' : countdown(next - now), { fg: C.bright }],
        ]
      }),
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
): RabePrevious {
  const counts: RabePrevious['counts'] = {}
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1

  return {
    endedAt,
    startedAt: usage.startedAt,
    counts,
    tokens: totals(items).tokens,
    usd: usage.usd,
    failed: items.filter(item => item.status === 'failed').map(item => item.title),
  }
}
