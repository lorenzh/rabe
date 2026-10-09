import { grid, type Span, spans } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { type BandRow, bandRows, costLine } from '../lists'
import type { View } from '../view'

// The one-line band names each count: [one, more].
const COUNT: Record<BandRow['kind'], [string, string]> = {
  failed: ['failed', 'failed'],
  agent: ['claude', 'claude'],
  codex: ['codex', 'codex'],
  workflow: ['workflow', 'workflows'],
  shell: ['shell', 'shells'],
  monitor: ['monitor', 'monitors'],
  cron: ['cron', 'cron'],
}

const cost = (parts: string[]): Span[] => [
  [parts[0] ?? '', { fg: C.bright }],
  [parts.length > 1 ? ` · ${parts.slice(1).join(' · ')}` : '', { fg: C.dim }],
]

// The band above the prompt: one line of count chips with the cost, under one
// empty row so the status line above does not touch it.
export const bandView: View = (model, size) => {
  const rows = bandRows(model.items, model.now)
  const money = costLine(model.items, model.usd)?.split(' · ')
  const g = grid(size.columns, 2)
  const chips = rows.flatMap((row): Span[] => {
    const n = row.names.length
    return [[` ${row.glyph} ${n} ${COUNT[row.kind][n === 1 ? 0 : 1]} `, CHIP[row.kind]], [' ']]
  })
  spans(g, 0, 1, [...chips, ...(money ? cost(money.slice(0, 2)) : [])])

  return { nodes: [{ chart: g }], buttons: [] }
}
