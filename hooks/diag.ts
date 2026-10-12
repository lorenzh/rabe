import type { EngineInterface, On } from 'claude-code'

import type { RabeDiag } from '../types'
import { shorten } from './loop'
import type { RabeItem } from './model'

export type DiagFacts = {
  rabe: string
  claude: string
  options: Record<string, unknown>
  diag: Record<string, RabeDiag>
  items: RabeItem[]
}

const POLLED = ['agents', 'codex', 'shells', 'monitors', 'worktrees']

// The report `/rabe-diag` prints. It has counts, sizes, versions and option
// values only: no prompt, title, message text or full path.
export function diagText(facts: DiagFacts): string {
  const options = Object.entries(facts.options).map(([key, value]) =>
    key === 'pricesFile' ? `pricesFile: ${value ? 'set' : 'not set'}` : `${key}: ${String(value)}`,
  )
  const counts = new Map<string, number>()
  for (const item of facts.items) {
    const key = `${item.kind} ${item.status}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const polls = POLLED.map(name => {
    const d = facts.diag[name]
    if (!d) return `- ${name}: no poll recorded (not due, inactive session, or hook unavailable)`

    return (
      `- ${name}: ${d.ms} ms, ${d.files} files, ${d.chars} chars, ${d.errors} errors` +
      (d.lastError ? `, last error: ${shorten(d.lastError)}` : '')
    )
  })

  return [
    `Rabe ${facts.rabe}, Claude Code ${facts.claude}`,
    `Options: ${options.join(', ') || 'none'}`,
    `Items: ${[...counts].map(([key, n]) => `${key} ${n}`).join(', ') || 'none'}`,
    'Last poll per source:',
    ...polls,
    '- crons, workflows: event sources, no polls',
  ].join('\n')
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
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'rabe-diag',
      description: 'Show what each Rabe source read last, without private data',
      immediate: true,
    })

    return started
  })
  on('command.run', { command: 'rabe-diag' }, async $ => ({ text: await report($, options) }))
  on('command.run', { command: 'rabe:report-bug' }, async ($, e, next) => {
    const result = await next(e)
    const text = await report($, options).catch(() => 'diagnostics unavailable')

    return { ...result, context: [...(result.context ?? []), `Rabe diagnostics:\n${text}`] }
  })
}
