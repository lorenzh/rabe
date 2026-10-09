import type { RabeItem } from '../../model'
import { nextRuns } from '../../schedule'
import { grid, type Span, wrap } from '../cells/grid'
import { C, type Style } from '../cells/palette'
import { ago, clockTime, countdown, tokens, usd } from '../format'
import { children, phases, share, sortItems, timeLabel, tokenSum } from '../lists'
import {
  canStop,
  type Drawn,
  type Model,
  type View,
  type ViewButton,
  type ViewInput,
} from '../view'
import { draw, headLines, itemLine, type Line, text } from './lines'

const dim = { fg: C.dim }
const BRIEF_ROWS = 3

const label = (value: string): Line => ({ spans: [[`▸ ${value}`, { fg: C.blue }]] })
const width = (list: Span[]) => list.reduce((n, [one]) => n + [...one].length, 0)

// A paragraph whose first line starts with `first`; the rest indent under it.
function lead(first: Span[], value: string, columns: number, style: Style = {}): Line[] {
  const indent = width(first)

  return wrap(value || ' ', Math.max(1, columns - indent)).map((one, i) => ({
    spans: i === 0 ? [...first, [one, style]] : [[`${' '.repeat(indent)}${one}`, style]],
  }))
}

const raise = (lines: Line[]): Line[] => lines.map(line => ({ ...line, bg: C.raised }))

// Spend and activity on a panel: agents and Codex jobs their own, a workflow its agents'.
function costBox(model: Model, item: RabeItem): Line[] {
  if (item.kind !== 'agent' && item.kind !== 'codex' && item.kind !== 'workflow') return []
  const list = item.kind === 'workflow' ? children(model.items, item.id) : [item]
  const known = list.filter(one => one.tokens)
  const sum = (key: 'input' | 'output' | 'cached') =>
    known.reduce((n, one) => n + (one.tokens?.[key] ?? 0), 0)
  const costs = list.filter(one => one.costUsd !== undefined)
  const cost: Span = costs.length
    ? [`≈ ${usd(costs.reduce((n, one) => n + (one.costUsd ?? 0), 0))}`, { fg: C.bright }]
    : ['cost n/a', dim]
  const cached = sum('cached')
  const tok: Span[] = known.length
    ? [
        ['   in ', dim],
        [tokens(sum('input'))],
        ['  out ', dim],
        [tokens(sum('output'))],
        ...(cached ? ([['  cached ', dim], [tokens(cached)]] as Span[]) : []),
      ]
    : [['   tokens n/a', dim]]
  const of: Span[] = [[share(model.items, item)], [' of session', dim]]
  const second: Span[] =
    item.kind === 'workflow'
      ? [[String(list.length)], [' agents', dim]]
      : item.kind === 'codex'
        ? [
            ...((item.detail.commandCount === undefined
              ? [['commands n/a  ', dim]]
              : [[String(item.detail.commandCount)], [' commands  ', dim]]) as Span[]),
            ...of,
          ]
        : of
  const at =
    item.kind === 'agent'
      ? item.detail.lastToolAt
      : item.kind === 'codex'
        ? item.detail.sessionUpdatedAt
        : undefined
  const right: Span[] =
    item.kind === 'workflow' || item.status !== 'running'
      ? []
      : at === undefined
        ? [['active n/a ', dim]]
        : [
            ['active', { fg: C.green }],
            [` ${ago(model.now - at)} `, dim],
          ]

  return [
    { spans: [[' '], cost, ...tok], bg: C.panel },
    { spans: [[' '], ...second], right, bg: C.panel },
    { spans: [] },
  ]
}

function brief(name: string, value: string | undefined, columns: number): Line[] {
  if (!value) return []
  const lines = text(value, columns, {}, '  ')
  if (lines.length > BRIEF_ROWS) {
    const last = lines[BRIEF_ROWS - 1]
    if (last) last.spans = [[`${last.spans[0]?.[0] ?? ''} …`]]
  }

  return [label(name), ...lines.slice(0, BRIEF_ROWS), { spans: [] }]
}

// What stays on top while the body scrolls: the cost panel, the brief or
// prompt, and the label of the body.
function topLines(model: Model, item: RabeItem, columns: number): Line[] {
  const box = costBox(model, item)
  switch (item.kind) {
    case 'agent':
      return [...box, ...brief('brief', item.detail.description, columns)]
    case 'codex':
      return [...box, ...brief('prompt', item.detail.prompt, columns)]
    case 'workflow':
      return box
    case 'shell': {
      const seen = model.lines[item.id]?.seen
      return [label(`output · newest last${seen ? ` · ${seen} lines` : ''}`)]
    }
    case 'monitor':
      return [label('lines received · newest last')]
    case 'cron':
      return [label(item.detail.scheduledFor === undefined ? 'next runs' : 'fires')]
  }
}

function agentLines(model: Model, item: RabeItem, columns: number): Line[] {
  const turns = model.turns[item.id] ?? []
  if (turns.length === 0) return [{ spans: [['Turns n/a: none seen since Rabe loaded.', dim]] }]

  return turns.flatMap((turn, i) => {
    const lines = [
      ...lead(
        [
          [String(turn.index).padEnd(3), dim],
          ['● ', { fg: C.orange }],
        ],
        turn.text || '(tools only)',
        columns,
      ),
      ...turn.tools.map(tool => ({
        spans: [[`     ⎿ ${tool.name} ${tool.summary ?? ''}`.trimEnd(), dim]] as Span[],
      })),
    ]
    return item.status === 'running' && i === turns.length - 1 ? raise(lines) : lines
  })
}

function commandLine(step: {
  text: string
  exitCode?: number
  lines?: number
  isRunning?: boolean
}): Line {
  const lines = step.lines === undefined ? '' : ` · ${step.lines} lines`
  const right: Span = step.isRunning
    ? ['◐ running ', { fg: C.yellow }]
    : step.exitCode === 0
      ? [`✓ exit 0${lines} `, { fg: C.green }]
      : [`✗ exit ${step.exitCode ?? 'n/a'}${lines} `, { fg: C.red }]
  const line: Line = { spans: [['  $ ', dim], [step.text]], right: [right] }

  return step.isRunning ? { ...line, bg: C.raised } : line
}

function codexLines(item: RabeItem, columns: number): Line[] {
  if (item.kind !== 'codex') return []
  const steps = item.detail.steps ?? []
  if (steps.length === 0) {
    return [{ spans: [['Session file n/a: steps, model and commands are not known.', dim]] }]
  }

  return steps.flatMap(step =>
    step.kind === 'command'
      ? [commandLine(step)]
      : step.kind === 'reasoning'
        ? text(`thinking: ${step.text}`, columns, dim, '  ')
        : lead([['● ', { fg: C.cyan }]], step.text, columns),
  )
}

function workflowLines(model: Model, item: RabeItem, columns: number): Line[] {
  const list = phases(model.items, item)
  const mark = { done: '✓', running: '◐', failed: '✗', waiting: '·' } as const
  const out: Line[] = text(
    list.map(p => `${mark[p.state]} ${p.name}`).join(' → ') || 'phases n/a',
    columns,
  )
  for (const p of list) {
    const note = (['done', 'failed', 'running'] as const)
      .map(s => [p.agents.filter(a => a.status === s).length, s] as const)
      .filter(([n]) => n > 0)
      .map(([n, s]) => `${n} ${s}`)
      .join(' · ')
    out.push({
      spans: [
        [p.name.toUpperCase(), { fg: C.green }],
        [` ${note || 'not started'}`, dim],
      ],
    })
    for (const agent of sortItems(p.agents)) {
      const tok = tokenSum(agent)
      out.push({
        ...itemLine(agent, model.now),
        right: [[`${tok < 0 ? 'n/a' : tokens(tok)} · ${timeLabel(agent, model.now)} `, dim]],
      })
    }
  }

  return out
}

function outputLines(model: Model, item: RabeItem): Line[] {
  const held = model.lines[item.id]?.lines ?? []
  const out: Line[] =
    held.length === 0
      ? [{ spans: [['Output n/a: no line read yet.', dim]] }]
      : held.map(line => ({
          spans:
            item.kind === 'monitor'
              ? [[`${clockTime(line.at)} `, dim], [line.text]]
              : [[line.text]],
        }))
  if (item.kind === 'shell' && item.detail.exitCode !== undefined) {
    const code = item.detail.exitCode
    out.push({
      spans: [[code === 0 ? '✓ exit 0' : `✗ exit ${code}`, { fg: code ? C.red : C.green }]],
    })
  }

  return out
}

function cronLines(model: Model, item: RabeItem): Line[] {
  if (item.kind !== 'cron') return []
  const { schedule, scheduledFor } = item.detail
  const runs =
    scheduledFor !== undefined ? [scheduledFor] : schedule ? nextRuns(schedule, model.now, 5) : []
  if (runs.length === 0) return [{ spans: [['Next runs n/a: the schedule is not known.', dim]] }]

  return runs.map(at => ({
    spans: [[`  ${clockTime(at).slice(0, 5)}`], [`  in ${countdown(at - model.now)}`, dim]],
  }))
}

// The body of one item's detail, newest last; callers keep the tail that fits.
export function bodyLines(model: Model, item: RabeItem, columns: number): Line[] {
  switch (item.kind) {
    case 'agent':
      return agentLines(model, item, columns)
    case 'codex':
      return codexLines(item, columns)
    case 'workflow':
      return workflowLines(model, item, columns)
    case 'cron':
      return cronLines(model, item)
    default:
      return outputLines(model, item)
  }
}

// One item in `rows` lines: head, the fixed top, then the newest body lines.
export function detailLines(model: Model, item: RabeItem, rows: number, columns: number): Line[] {
  const top = [...headLines(model, item), ...topLines(model, item, columns)]
  const room = rows - top.length
  const body = room > 0 ? bodyLines(model, item, columns).slice(-room) : []

  return [...top, ...body].slice(0, rows)
}

function detailButtons(item: RabeItem, hasInput: boolean): ViewButton[] {
  const buttons: ViewButton[] = [
    {
      key: 'back',
      label: 'b: back',
      hotkey: 'b',
      autoFocus: true,
      action: { type: 'open', id: '' },
    },
  ]
  const d = item.detail as Record<string, unknown>
  const copy =
    typeof d.command === 'string'
      ? d.command
      : item.kind === 'cron'
        ? item.detail.prompt
        : undefined
  if (copy !== undefined) {
    const label = item.kind === 'cron' ? 'c: copy prompt' : 'c: copy command'
    buttons.push({ key: 'copy', label, hotkey: 'c', action: { type: 'copy', text: copy } })
  }
  if (item.kind === 'cron' && item.detail.scheduledFor === undefined) {
    buttons.push({
      key: 'delete',
      label: 'd: delete job',
      hotkey: 'd',
      action: { type: 'delete', id: item.id },
    })
  }
  if (item.kind === 'agent' && item.status === 'running' && hasInput) {
    buttons.push({
      key: 'message-agent',
      label: 'm: message',
      hotkey: 'm',
      action: { type: 'focus', key: 'message' },
    })
  }
  if (canStop(item)) {
    const isRun = item.kind === 'workflow'
    buttons.push({
      key: 'stop',
      label: isRun ? 'g: stop run' : 'x: stop',
      hotkey: isRun ? 'g' : 'x',
      action: { type: 'stop', ids: [item.id] },
    })
  }

  return buttons
}

// One item in full, in place of the list: facts, then the newest body lines.
export const detailView: View = (model, size, sel): Drawn => {
  const g = grid(size.columns, size.rows)
  const item = model.items.find(one => one.id === sel.open)
  if (!item) return { grid: g, buttons: [] }
  const shown = detailLines(model, item, size.rows, size.columns)
  draw(g, 0, 0, size.columns, shown)
  const inputs: ViewInput[] =
    item.kind === 'agent' && item.status === 'running' && size.hasInput
      ? [
          {
            key: 'message',
            label: 'message',
            placeholder: 'text for the agent',
            submitLabel: 'send',
            action: value => ({ type: 'message', id: item.id, text: value }),
          },
        ]
      : []
  const rows: Drawn['rows'] = {}
  shown.forEach((line, y) => {
    if (line.action) rows[y] = line.action
  })

  return { grid: g, buttons: detailButtons(item, size.hasInput), inputs, rows }
}
