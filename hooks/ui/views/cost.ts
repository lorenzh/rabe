import { fit, grid } from '../cells/grid'
import { C, tone } from '../cells/palette'
import { tokens, usd } from '../format'
import { byTokens, cost, glyph, KIND_LABEL, tokenSum, totals } from '../lists'
import type { Drawn, View } from '../view'
import { draw, type Line } from './lines'

const dim = { fg: C.dim }

// The Cost tab: the session total, then agents and Codex jobs by tokens.
export const costView: View = (model, size): Drawn => {
  const g = grid(size.columns, size.rows)
  const sum = totals(model.items)
  const running = model.items.filter(item => item.status === 'running').length
  const list = byTokens(model.items)
  const nameWidth = Math.max(12, size.columns - 22)
  const head: Line[] = [
    {
      spans: [
        [
          `session total ${sum.usd === undefined ? 'cost n/a' : `≈ ${usd(sum.usd)}`}`,
          { fg: C.bright },
        ],
      ],
    },
    {
      spans: [
        [
          `tokens ${tokens(sum.tokens)} · claude ${cost(sum.claude)} · codex ${cost(sum.codex)}${sum.unknown ? ` · ${sum.unknown} n/a` : ''} · running ${running}`,
          dim,
        ],
      ],
    },
    { spans: [] },
    { spans: [[`  ${fit('NAME', nameWidth)} ${fit('TOKENS', 8)}COST`, dim]] },
  ]
  const room = Math.max(0, size.rows - head.length - 1)
  const rowsOf: Line[] = list.slice(0, room).map(item => {
    const tok = tokenSum(item)
    return {
      spans: [
        [`${glyph(item)} `, { fg: tone(item) }],
        [`${fit(`${KIND_LABEL[item.kind]} ${item.title}`, nameWidth)} `],
        [`${fit(tok < 0 ? 'n/a' : tokens(tok), 8)}${cost(item.costUsd)}`, dim],
      ],
      action: { key: `row:${item.id}`, action: { type: 'open', id: item.id } },
    }
  })
  const tail: Line[] =
    list.length === 0
      ? [{ spans: [['No agent or Codex job yet.', dim]] }]
      : list.length > room
        ? [{ spans: [[`… ${list.length - room} more`, dim]] }]
        : []
  const shown = [...head, ...rowsOf, ...tail]
  draw(g, 0, 0, size.columns, shown)
  const rows: Drawn['rows'] = {}
  shown.forEach((line, y) => {
    if (line.action) rows[y] = line.action
  })

  return { grid: g, buttons: [], rows }
}
