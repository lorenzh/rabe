import type { RabePrevious } from '../../types'
import type { RabeItem, RabeItemKind } from '../model'
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

export function grouped(items: RabeItem[]): { id: Group; label: string; items: RabeItem[] }[] {
  return GROUPS.map(group => ({
    ...group,
    items: sortItems(items.filter(item => groupOf(item) === group.id)),
  })).filter(group => group.items.length > 0)
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
