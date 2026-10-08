import type { RabeItem } from '../../model'
import { grid, type Span } from '../cells/grid'
import { C } from '../cells/palette'
import { upcoming } from '../facts'
import { clockTime, tokens } from '../format'
import { phases, sortItems, tokenSum } from '../lists'
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

function agentLines(model: Model, item: RabeItem, width: number): Line[] {
  const turns = model.turns[item.id] ?? []
  if (turns.length === 0) return [{ spans: [['Turns n/a: none seen since Rabe loaded.', dim]] }]

  return turns.flatMap(turn => [
    ...text(`${turn.index} ● ${turn.text || '(tools only)'}`, width),
    ...turn.tools.map(tool => ({
      spans: [[`   ⎿ ${tool.name} ${tool.summary ?? ''}`.trimEnd(), dim]] as Span[],
    })),
  ])
}

function commandLine(step: {
  text: string
  exitCode?: number
  lines?: number
  isRunning?: boolean
}): Line {
  const lines = step.lines === undefined ? '' : ` · ${step.lines} lines`
  const right: Span = step.isRunning
    ? ['◐ running', { fg: C.yellow }]
    : step.exitCode === 0
      ? [`✓ exit 0${lines}`, { fg: C.green }]
      : [`✗ exit ${step.exitCode ?? 'n/a'}${lines}`, { fg: C.red }]

  return { spans: [[`  $ ${step.text}`, dim]], right: [right] }
}

function codexLines(item: RabeItem, width: number): Line[] {
  if (item.kind !== 'codex') return []
  const d = item.detail
  const prompt = d.prompt
    ? [{ spans: [['▸ prompt', { fg: C.blue }]] as Span[] }, ...text(d.prompt, width, {}, '  ')]
    : []
  if (!d.steps?.length) {
    return [
      ...prompt,
      { spans: [['Session file n/a: steps, model and commands are not known.', dim]] },
    ]
  }
  const steps = d.steps.flatMap(step =>
    step.kind === 'command'
      ? [commandLine(step)]
      : step.kind === 'reasoning'
        ? text(`thinking: ${step.text}`, width, dim, '  ')
        : text(`◆ ${step.text}`, width),
  )

  return [...prompt, ...steps]
}

function workflowLines(model: Model, item: RabeItem, width: number): Line[] {
  const list = phases(model.items, item)
  const mark = { done: '✓', running: '◐', failed: '✗', waiting: '·' } as const
  const out: Line[] = text(
    list.map(p => `${mark[p.state]} ${p.name}`).join(' → ') || 'phases n/a',
    width,
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
        right: [[`${tok < 0 ? 'n/a' : tokens(tok)} `, dim]],
      })
    }
  }

  return out
}

function outputLines(model: Model, item: RabeItem): Line[] {
  const held = model.lines[item.id]?.lines ?? []
  if (held.length === 0) return [{ spans: [['Output n/a: no line read yet.', dim]] }]
  const stamp = item.kind === 'monitor'

  return held.map(line => ({
    spans: stamp ? [[`${clockTime(line.at)} `, dim], [line.text]] : [[line.text]],
  }))
}

// The body of one item's detail, newest last; callers keep the tail that fits.
export function bodyLines(model: Model, item: RabeItem, width: number): Line[] {
  switch (item.kind) {
    case 'agent':
      return agentLines(model, item, width)
    case 'codex':
      return codexLines(item, width)
    case 'workflow':
      return workflowLines(model, item, width)
    case 'cron': {
      const runs = upcoming(item, model.now)
      return runs.length ? [{ spans: [['next runs ', dim], [runs.join('  ')]] }] : []
    }
    default:
      return outputLines(model, item)
  }
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
  const head = headLines(model, item)
  const body = bodyLines(model, item, size.columns)
  const shown = [...head, ...body.slice(-Math.max(0, size.rows - head.length))]
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
    if (line.action && y >= head.length) rows[y] = line.action
  })

  return { grid: g, buttons: detailButtons(item, size.hasInput), inputs, rows }
}
