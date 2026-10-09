import type { RabeItem } from '../../model'
import { bar, fit, grid } from '../cells/grid'
import { C, CHIP, type Style, tone } from '../cells/palette'
import { duration, short, tokens, usd } from '../format'
import { byTokens, cost, glyph, tokenSum, totals } from '../lists'
import type { Drawn, Model, View } from '../view'
import { draw, type Line, moveButtons, windowStart } from './lines'

const dim = { fg: C.dim }
const LONG_TOOL = 2 * 60_000
const STUCK = 5 * 60_000
// TOKENS, COST and TIME, right-aligned.
const RIGHT = 8 + 9 + 7

function barStyle(item: RabeItem): Style {
  if (item.status === 'failed') return { fg: C.red }
  if (item.status === 'done') return { fg: C.green }
  if (item.status === 'stopped') return dim

  return { fg: CHIP[item.kind].fg }
}

function workerLine(
  item: RabeItem,
  max: number,
  now: number,
  nameWidth: number,
  barWidth: number,
  isSelected: boolean,
): Line {
  const tok = tokenSum(item)
  const time = item.startedAt === undefined ? 'n/a' : short((item.endedAt ?? now) - item.startedAt)
  const blocks = tok < 0 ? '▏'.padEnd(barWidth) : bar(tok, max, barWidth)

  return {
    spans: [
      [isSelected ? '▌' : ' ', { fg: C.orange }],
      [glyph(item), { fg: tone(item) }],
      [` ${fit(item.title, nameWidth - 3)}`],
      [barWidth ? ` ${blocks}` : '', tok < 0 ? dim : barStyle(item)],
      [(tok < 0 ? 'n/a' : tokens(tok)).padStart(8), tok < 0 ? dim : {}],
      [cost(item.costUsd).padStart(9), item.costUsd === undefined ? dim : {}],
      [time.padStart(7)],
    ],
    ...(isSelected && { bg: C.selected }),
    action: { key: `row:${item.id}`, action: { type: 'open', id: item.id } },
  }
}

const note = (label: string, chip: Style, title: string, why: string): Line => ({
  spans: [[` ${label} `, chip], [` ${title}`], [` · ${why}`, dim]],
})

// Running agents that look slow: a tool call open for a while, or no step at all.
function loadLines(model: Model): Line[] {
  const out: Line[] = []
  for (const item of model.items) {
    if (item.kind !== 'agent' || item.status !== 'running') continue
    const last = model.turns[item.id]?.at(-1)
    const since = last?.at ?? item.startedAt
    if (since === undefined) continue
    const idle = model.now - since
    const tool = last?.tools.at(-1)
    if (tool && idle >= LONG_TOOL) {
      out.push(note('◷ long tool', CHIP.cost, item.title, `in ${tool.name} for ${duration(idle)}`))
    } else if (!tool && idle >= STUCK) {
      out.push(note('⚠ stuck', CHIP.shell, item.title, `no step for ${short(idle)}`))
    }
  }

  return out.length ? out : [{ spans: [[' Nothing looks stuck.', dim]] }]
}

// The Cost tab: the session's cost and totals, the workers by tokens with a
// bar each, and the agents that look slow.
export const costView: View = (model, size, sel): Drawn => {
  const g = grid(size.columns, size.rows)
  const sum = totals(model.items)
  const running = model.items.filter(item => item.status === 'running').length
  const list = byTokens(model.items)
  const selected = list.find(item => item.id === sel.selected) ?? list[0]
  const nameWidth = Math.max(12, Math.min(24, size.columns - RIGHT - 12))
  const room = size.columns - nameWidth - RIGHT - 1
  const barWidth = room >= 4 ? room : 0
  const max = Math.max(1, ...list.map(tokenSum))
  const session = model.usd === undefined ? 'session cost n/a' : `≈ ${usd(model.usd)} session`
  const head: Line[] = [
    {
      bg: C.panel,
      spans: [
        [` ${session} `, { fg: C.bright }],
        [' claude ', dim],
        [cost(sum.claude), { fg: C.orange }],
        ['   codex ', dim],
        [cost(sum.codex), { fg: C.cyan }],
        ['   tokens ', dim],
        [tokens(sum.tokens), { fg: C.bright }],
        ['   running ', dim],
        [String(running), { fg: C.yellow }],
        [sum.unknown ? `   ${sum.unknown} n/a` : '', dim],
      ],
    },
    { spans: [] },
    { spans: [['by worker · sorted by tokens', dim]] },
    {
      spans: [
        [
          `${fit('  NAME', nameWidth)}${' '.repeat(barWidth ? barWidth + 1 : 0)}${'TOKENS'.padStart(8)}${'COST'.padStart(9)}${'TIME'.padStart(7)}`,
          dim,
        ],
      ],
    },
  ]
  const free = model.items.some(
    item => item.kind === 'shell' || item.kind === 'monitor' || item.kind === 'cron',
  )
  const after: Line[] = [
    ...(free ? [{ spans: [[' shells, monitors and cron jobs use no tokens', dim]] } as Line] : []),
    { spans: [] },
    { spans: [['LOAD', { fg: C.bright }]] },
    ...loadLines(model),
  ]
  const rowsLeft = Math.max(1, size.rows - head.length - after.length - 1)
  const start = windowStart(list.length, selected ? list.indexOf(selected) : 0, rowsLeft)
  const workers: Line[] = list.length
    ? list
        .slice(start, start + rowsLeft)
        .map(item => workerLine(item, max, model.now, nameWidth, barWidth, item === selected))
    : [{ spans: [[' No agent or Codex job yet.', dim]] }]
  const shown = [...head, ...workers, ...after]
  draw(g, 0, 0, size.columns, shown)
  const isGone = model.items.some(item => item.kind === 'codex' && item.detail.isSessionMissing)
  const foot = ['session cost as /cost totals it', isGone && 'n/a: a Codex session file is gone']
  draw(g, 0, g.rows - 1, size.columns, [{ spans: [[foot.filter(Boolean).join(' · '), dim]] }])
  const rows: Drawn['rows'] = {}
  shown.forEach((line, y) => {
    if (line.action && y < g.rows - 1) rows[y] = line.action
  })

  return { grid: g, buttons: moveButtons(list, selected), rows }
}
