import { grid, type Span, spans } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { type BandRow, bandRows, costLine, joinFit } from '../lists'
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

// The band above the prompt: one row per kind with a colored chip, then the
// cost; one line of count chips when the rows do not fit in `size.rows`
// (maxRows). The grid is exactly as tall as its lines, so it never draws an
// empty one.
export const bandView: View = (model, size) => {
  const rows = bandRows(model.items, model.now)
  const money = costLine(model.items, model.usd)?.split(' · ')
  const count = rows.length + (money ? 1 : 0)
  if (count > size.rows) {
    const g = grid(size.columns, 1)
    const chips = rows.flatMap((row): Span[] => {
      const n = row.names.length
      return [[` ${row.glyph} ${n} ${COUNT[row.kind][n === 1 ? 0 : 1]} `, CHIP[row.kind]], [' ']]
    })
    spans(g, 0, 0, [...chips, ...(money ? cost(money.slice(0, 2)) : [])])
    return { grid: g, buttons: [] }
  }
  const g = grid(size.columns, count)
  const labels = rows.map(row => `${row.glyph} ${row.label} ${row.names.length}`)
  const chip = Math.max(10, ...labels.map(label => label.length)) + 2
  const names = size.columns - chip - 1
  rows.forEach((row, y) => {
    spans(g, 0, y, [
      [` ${labels[y]}`.padEnd(chip), CHIP[row.kind]],
      [' '],
      ...joinFit(row.names, names),
    ])
  })
  if (money) {
    spans(g, 0, rows.length, [[' $ cost'.padEnd(chip), CHIP.cost], [' '], ...cost(money)])
  }

  return { grid: g, buttons: [] }
}
