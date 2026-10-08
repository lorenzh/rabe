import { grid, spans } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { bandLine, bandRows, costLine, joinFit } from '../lists'
import type { View } from '../view'

const CHIP_WIDTH = 12

// The band above the prompt: one row per kind with a colored chip, then the
// cost; one summary line when the rows do not fit in `size.rows` (maxRows).
// The grid is exactly as tall as its lines, so it never draws an empty one.
export const bandView: View = (model, size) => {
  const rows = bandRows(model.items, model.now)
  const cost = costLine(model.items)
  const count = rows.length + (cost ? 1 : 0)
  if (count > size.rows) {
    const g = grid(size.columns, 1)
    spans(g, 0, 0, [[`${bandLine(model.items, model.now)} · /rabe for details`]])
    return { grid: g, buttons: [] }
  }
  const g = grid(size.columns, count)
  const names = size.columns - CHIP_WIDTH - 1
  rows.forEach((row, y) => {
    const chip = `${` ${row.glyph} ${row.label} ${row.names.length}`.padEnd(CHIP_WIDTH)}`
    spans(g, 0, y, [
      [chip, CHIP[row.kind]],
      [' '],
      [joinFit(row.names, names), { fg: row.kind === 'failed' ? C.red : C.text }],
    ])
  })
  if (cost) {
    spans(g, 0, rows.length, [
      [' $ cost'.padEnd(CHIP_WIDTH), CHIP.cost],
      [' '],
      [cost, { fg: C.dim }],
    ])
  }

  return { grid: g, buttons: [] }
}
