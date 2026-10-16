import type { EngineInterface, On } from 'claude-code'

import type { RabeDiag } from '../types'
import { shorten } from './loop'
import { KINDS, type RabeItem } from './model'
import { isRecord } from './reading'

export type DiagFacts = {
  rabe: string
  claude: string
  options: Record<string, unknown>
  diag: Record<string, RabeDiag>
  items: RabeItem[]
}

const POLLED = ['agents', 'codex', 'shells', 'ports', 'monitors', 'worktrees']

// The report `/rabe-diag` prints. It has counts, sizes, versions and option
// values only: fixed words, numbers and versions.
export function diagText(facts: DiagFacts): string {
  const options = [
    `pricesFile: ${facts.options.pricesFile ? 'set' : 'not set'}`,
    `hideBuiltinTasks: ${typeof facts.options.hideBuiltinTasks === 'boolean' ? facts.options.hideBuiltinTasks : 'n/a'}`,
    `timelineHours: ${typeof facts.options.timelineHours === 'number' && Number.isFinite(facts.options.timelineHours) ? facts.options.timelineHours : 'n/a'}`,
  ]
  const counts = new Map<string, number>()
  for (const item of Array.isArray(facts.items) ? facts.items : []) {
    if (
      !item ||
      !(KINDS as readonly string[]).includes(item.kind) ||
      !['running', 'idle', 'done', 'failed', 'stopped'].includes(item.status)
    )
      continue
    const key = `${item.kind} ${item.status}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const polls = POLLED.map(name => {
    const d = isRecord(facts.diag) ? facts.diag[name] : undefined
    if (!isRecord(d))
      return `- ${name}: no poll recorded (not due, inactive session, or hook unavailable)`

    return (
      `- ${name}: ${count(d.ms)} ms, ${count(d.files)} files, ${count(d.chars)} chars, ${count(d.bytes)} bytes, ${count(d.skipped)} skipped, ${count(d.errors)} errors` +
      (d.lastError ? `, last error: ${shorten(d.lastError)}` : '')
    )
  })

  return [
    `Rabe ${versionOf(facts.rabe)}, Claude Code ${versionOf(facts.claude)}`,
    `Options: ${options.join(', ') || 'none'}`,
    `Items: ${[...counts].map(([key, n]) => `${key} ${n}`).join(', ') || 'none'}`,
    'Last poll per source:',
    ...polls,
    '- crons, workflows: event sources, no polls',
  ].join('\n')
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function versionOf(value: unknown): string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : 'n/a'
}

async function report($: EngineInterface, options: Record<string, unknown>) {
  const read = async () => {
    try {
      const text = String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
      return String(JSON.parse(text).version ?? 'n/a')
    } catch {
      return 'n/a'
    }
  }
  const { value: diag = {} } = await $.state.get({ plugin: 'rabe', key: 'diag' })
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const claude = await $.session
    .version()
    .then(v => v.version)
    .catch(() => 'n/a')

  return diagText({ rabe: await read(), claude, options, diag, items })
}

// `/rabe-diag`: why Rabe shows n/a or misses something, safe to paste in a report.
export function diag(on: On, all: Record<string, unknown>): void {
  const options = Object.fromEntries(
    ['hideBuiltinTasks', 'pricesFile', 'timelineHours'].map(key => [key, all[key]]),
  )
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    await $.command
      .register({
        name: 'rabe-diag',
        description: 'Show what each Rabe source read last, without private data',
        immediate: true,
      })
      .catch(() => undefined)

    return started
  })
  on('command.run', { command: 'rabe-diag' }, async $ => ({
    text: await report($, options).catch(() => 'diagnostics unavailable'),
  }))
  on('command.run', { command: 'rabe:report-bug' }, async ($, e, next) => {
    const result = await next(e)
    const text = await report($, options).catch(() => 'diagnostics unavailable')

    return { ...result, context: [...(result.context ?? []), `Rabe diagnostics:\n${text}`] }
  })
}
