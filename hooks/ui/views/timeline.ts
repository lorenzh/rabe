import { fit, grid } from '../cells/grid'
import { C, tone } from '../cells/palette'
import { clockTime } from '../format'
import { bar, glyph, KIND_LABEL, tree } from '../lists'
import type { Drawn, View } from '../view'
import { draw, type Line } from './lines'

const dim = { fg: C.dim }

// The Timeline tab: one bar per item over the session, then who started what.
export const timelineView: View = (model, size): Drawn => {
  const g = grid(size.columns, size.rows)
  const list = model.items
    .filter(item => item.kind !== 'cron')
    .toSorted((a, b) => (a.startedAt ?? a.seenAt) - (b.startedAt ?? b.seenAt))
  const start = Math.min(model.now - 60_000, ...list.map(item => item.startedAt ?? item.seenAt))
  const labelWidth = Math.min(28, Math.floor(size.columns / 3))
  const barWidth = Math.max(10, size.columns - labelWidth - 1)
  const room = Math.max(1, Math.floor((size.rows - 5) / 2))
  const bars: Line[] = list.slice(-room).map(item => ({
    spans: [
      [`${fit(`${glyph(item)} ${item.title}`, labelWidth)} `],
      [
        bar(item.startedAt ?? item.seenAt, item.endedAt ?? model.now, start, model.now, barWidth),
        { fg: tone(item) },
      ],
    ],
  }))
  const lines: Line[] = [
    { spans: [['WHEN DID THINGS RUN?', { fg: C.orange }]] },
    {
      spans: [
        [`${' '.repeat(labelWidth + 1)}${fit(clockTime(start).slice(0, 5), barWidth - 3)}now`, dim],
      ],
    },
    ...bars,
    { spans: [['WHO STARTED WHAT?', { fg: C.orange }]] },
    { spans: [['main session']] },
    ...tree(model.items)
      .slice(0, room)
      .map(
        line =>
          ({
            spans: [
              [line.prefix, dim],
              [`${glyph(line.item)} `, { fg: tone(line.item) }],
              [`${KIND_LABEL[line.item.kind]} ${line.item.title}`],
            ],
          }) as Line,
      ),
  ]
  draw(g, 0, 0, size.columns, lines.slice(0, size.rows))

  return { grid: g, buttons: [] }
}
