import type { RabeFilter } from '../../types'
import type { RabeItem, RabeItemKind } from '../model'
import { nextRuns } from './cron'
import { ago, countdown, duration, short, tokens, usd } from './format'

export type Group = Exclude<RabeFilter, 'all'>

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

const RUNNING_TONE: Record<RabeItemKind, string> = {
  agent: 'warning',
  codex: 'warning',
  workflow: 'success',
  shell: 'warning',
  monitor: 'suggestion',
  cron: 'merged',
}

export function glyph(item: RabeItem): string {
  if (item.status === 'failed') return '✗'
  if (item.status === 'done') return '✓'
  if (item.status === 'stopped') return '■'

  return RUNNING_GLYPH[item.kind]
}

export function tone(item: RabeItem): string {
  if (item.status === 'failed') return 'error'
  if (item.status === 'done') return 'success'
  if (item.status === 'stopped') return 'subtle'

  return RUNNING_TONE[item.kind]
}

export function nextRun(item: RabeItem, now: number): number | undefined {
  if (item.kind !== 'cron') return undefined
  if (item.detail.scheduledFor !== undefined) return item.detail.scheduledFor

  return item.detail.schedule ? nextRuns(item.detail.schedule, now, 1)[0] : undefined
}

export function name(item: RabeItem): string {
  if (item.kind !== 'shell') return item.title
  const port = item.detail.port === undefined ? '' : ` :${item.detail.port}`
  const exit =
    item.status === 'failed' && item.detail.exitCode !== undefined
      ? ` exit ${item.detail.exitCode}`
      : ''

  return `${item.title}${port}${exit}`
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

export type Totals = { usd: number; tokens: number; unknown: number; claude: number; codex: number }

export function totals(items: RabeItem[]): Totals {
  const out: Totals = { usd: 0, tokens: 0, unknown: 0, claude: 0, codex: 0 }
  for (const item of items) {
    if (item.kind !== 'agent' && item.kind !== 'codex') continue
    if (!item.tokens) out.unknown += 1
    const tok = item.tokens ? item.tokens.input + item.tokens.output : 0
    out.tokens += tok
    out.usd += item.costUsd ?? 0
    if (item.kind === 'agent') out.claude += item.costUsd ?? 0
    else out.codex += item.costUsd ?? 0
  }

  return out
}

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

export function costLine(items: RabeItem[]): string | undefined {
  const sum = totals(items)
  if (sum.tokens === 0) return undefined
  const top = byTokens(items)[0]
  const topText = top?.tokens ? ` · top: ${top.title} ${tokens(tokenSum(top))}` : ''

  return `${tokens(sum.tokens)} tok ≈ ${usd(sum.usd)}${topText}`
}

export type BandRow = { glyph: string; tone: string; label: string; names: string[] }

const isRunning = (kind: RabeItemKind) => (item: RabeItem) =>
  item.kind === kind && item.status === 'running'

export function bandRows(items: RabeItem[], now: number): BandRow[] {
  const run = (item: RabeItem) =>
    item.startedAt === undefined ? '' : ` ${short(now - item.startedAt)}`
  const failed = items.filter(
    item => item.status === 'failed' && now - (item.endedAt ?? item.seenAt) < 10 * 60_000,
  )
  const rows: BandRow[] = [
    {
      glyph: '◐',
      tone: 'warning',
      label: 'claude',
      names: items.filter(isRunning('agent')).map(item => `${item.title}${run(item)}`),
    },
    {
      glyph: '◐',
      tone: 'warning',
      label: 'codex',
      names: items.filter(isRunning('codex')).map(item => `${item.title}${run(item)}`),
    },
    {
      glyph: '⧉',
      tone: 'success',
      label: 'workflow',
      names: items
        .filter(isRunning('workflow'))
        .map(
          flow =>
            `${flow.title} · ${phaseProgress(items, flow)} · ${children(items, flow.id).length} agents`,
        ),
    },
    {
      glyph: '▶',
      tone: 'warning',
      label: 'shells',
      names: items.filter(isRunning('shell')).map(name),
    },
    { glyph: '✗', tone: 'error', label: 'failed', names: failed.map(name) },
    {
      glyph: '◉',
      tone: 'suggestion',
      label: 'watch',
      names: items.filter(isRunning('monitor')).map(name),
    },
    {
      glyph: '⟳',
      tone: 'merged',
      label: 'cron',
      names: items.filter(isRunning('cron')).map(item => `${item.title} ${timeLabel(item, now)}`),
    },
  ]

  return rows.filter(row => row.names.length > 0)
}

export function joinFit(names: string[], width: number): string {
  let text = ''
  for (const [i, one] of names.entries()) {
    const next = text ? `${text} · ${one}` : one
    const rest = names.length - i - 1
    if (i > 0 && next.length + (rest ? ` +${rest}`.length : 0) > width) {
      return `${text} +${names.length - i}`
    }
    text = next
  }

  return text
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function bandLine(items: RabeItem[], now: number): string {
  const count = (kind: RabeItemKind) => items.filter(isRunning(kind)).length
  const claude = count('agent')
  const codex = count('codex')
  const failed = items.filter(
    item => item.status === 'failed' && now - (item.endedAt ?? 0) < 600_000,
  )
  const parts = [
    claude + codex > 0 && `◐ ${plural(claude + codex, 'agent')} (${claude} claude, ${codex} codex)`,
    count('shell') > 0 && `▶ ${plural(count('shell'), 'shell')}`,
    failed.length > 0 && `✗ ${failed.length} failed`,
    count('monitor') > 0 && `◉ ${plural(count('monitor'), 'monitor')}`,
    count('cron') > 0 && `⟳ ${count('cron')} cron`,
    count('workflow') > 0 && `⧉ ${plural(count('workflow'), 'workflow')}`,
    costLine(items)?.split(' · ')[0],
  ]

  return parts.filter(Boolean).join(' · ')
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
      name: path.split('/').filter(Boolean).at(-1) ?? path,
      branch: item.detail.worktreeBranch ?? 'n/a',
      items: [],
    }
    entry.items.push(item)
    out.set(path, entry)
  }

  return [...out.values()]
}
