import type { RabeItem } from '../model'
import { nextRuns } from '../schedule'
import { clockTime, countdown, duration, tokens, usd } from './format'
import { children, glyph, KIND_LABEL, nextRun, share } from './lists'

export type Facts = { title: string; status: string; lines: string[] }

const na = (value: unknown) => (value === undefined || value === '' ? 'n/a' : String(value))
const base = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

function statusWord(item: RabeItem, now: number): string {
  if (item.status !== 'running') {
    const exit = item.kind === 'shell' && item.detail.exitCode !== undefined
    return exit ? `${item.status} · exit ${item.detail.exitCode}` : item.status
  }
  if (item.kind === 'monitor') return 'watching'
  if (item.kind === 'cron') {
    const next = nextRun(item, now)
    return next === undefined ? 'scheduled' : `next in ${countdown(next - now)}`
  }

  return 'running'
}

function ran(item: RabeItem, now: number): string {
  if (item.startedAt === undefined) return 'started before Rabe loaded · start time not known'
  const end = item.endedAt ?? now
  const span = `${clockTime(item.startedAt)} → ${item.endedAt ? clockTime(end) : 'now'}`

  return `ran ${span} · ${duration(end - item.startedAt)}`
}

export function spend(items: RabeItem[], item: RabeItem): string {
  const list = item.kind === 'workflow' ? children(items, item.id) : [item]
  const known = list.filter(one => one.tokens)
  if (known.length === 0) return 'tokens n/a · cost n/a'
  const input = known.reduce((n, one) => n + (one.tokens?.input ?? 0), 0)
  const output = known.reduce((n, one) => n + (one.tokens?.output ?? 0), 0)
  const cached = known.reduce((n, one) => n + (one.tokens?.cached ?? 0), 0)
  const costs = list.filter(one => one.costUsd !== undefined)
  const cost = costs.length
    ? `≈ ${usd(costs.reduce((n, one) => n + (one.costUsd ?? 0), 0))}`
    : 'cost n/a'
  const cache = cached ? ` · cached ${tokens(cached)}` : ''
  const of = item.kind === 'workflow' ? '' : ` · ${share(items, item)} of session`

  return `${cost} · in / out ${tokens(input)} / ${tokens(output)}${cache}${of}`
}

export function facts(item: RabeItem, now: number, items: RabeItem[]): Facts {
  const parent = items.find(one => one.id === item.parentId)
  const by = `started by ${parent ? `${KIND_LABEL[parent.kind]} ${parent.title}` : 'main session'}`
  const lines: string[] = []
  switch (item.kind) {
    case 'agent': {
      const d = item.detail
      const tree = d.worktreePath
        ? `worktree ${base(d.worktreePath)}`
        : d.cwd
          ? 'main tree'
          : 'tree n/a'
      lines.push(`${na(d.type)} · ${na(d.model)} · ${tree}`)
      if (d.worktreeBranch) lines.push(`branch ${d.worktreeBranch}`)
      if (d.workflowPhase) lines.push(`phase ${d.workflowPhase}`)
      lines.push(spend(items, item), by, ran(item, now))
      break
    }
    case 'codex': {
      const d = item.detail
      lines.push(`model ${na(d.model)} · effort ${na(d.effort)} · job ${d.jobId}`)
      lines.push(spend(items, item), by, ran(item, now))
      break
    }
    case 'workflow': {
      const d = item.detail
      lines.push(`run ${d.runId} · ${children(items, item.id).length} agents`)
      if (d.scriptPath) lines.push(`script ${d.scriptPath}`)
      lines.push(spend(items, item), ran(item, now))
      break
    }
    case 'shell': {
      const d = item.detail
      lines.push(`command ${d.command}`, `task ${na(d.taskId)}`, by, ran(item, now))
      if (d.exitCode !== undefined) lines.push(`exit code ${d.exitCode}`)
      if (d.port !== undefined) lines.push(`port :${d.port}`)
      break
    }
    case 'monitor': {
      const d = item.detail
      if (d.description) lines.push(`description ${d.description}`)
      lines.push(`command ${d.command}`, by, ran(item, now))
      if (d.timeoutMs !== undefined) {
        const left =
          item.startedAt === undefined
            ? ''
            : ` · ${duration(item.startedAt + d.timeoutMs - now)} left`
        lines.push(`timeout ${duration(d.timeoutMs)}${item.status === 'running' ? left : ''}`)
      }
      lines.push(
        `persistent ${d.isPersistent === undefined ? 'n/a' : d.isPersistent ? 'yes' : 'no'}`,
      )
      break
    }
    case 'cron': {
      const d = item.detail
      if (d.scheduledFor !== undefined) lines.push(`fires at ${clockTime(d.scheduledFor)}`)
      else lines.push(`schedule ${na(d.schedule)}${d.humanSchedule ? ` · ${d.humanSchedule}` : ''}`)
      lines.push(
        `prompt ${d.prompt}`,
        `job ${d.jobId}`,
        `created ${clockTime(item.seenAt)} · ${by}`,
      )
      break
    }
  }

  return {
    title: `${KIND_LABEL[item.kind]} · ${item.title}`,
    status: `${glyph(item)} ${statusWord(item, now)}`,
    lines,
  }
}

export function upcoming(item: RabeItem, now: number): string[] {
  if (item.kind !== 'cron' || !item.detail.schedule || item.detail.scheduledFor !== undefined)
    return []

  return nextRuns(item.detail.schedule, now, 5).map(t => clockTime(t).slice(0, 5))
}
