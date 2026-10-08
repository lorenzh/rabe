import type { RabeItem } from '../../model'
import { type Grid, type Span, spans, wrap } from '../cells/grid'
import { C, type Style, tone } from '../cells/palette'
import { facts } from '../facts'
import { glyph, name, timeLabel } from '../lists'
import type { Action, Model } from '../view'

export type Line = {
  spans: Span[]
  right?: Span[]
  bg?: number
  action?: { key: string; action: Action }
}

// Draws lines from row `y`, each cut to `width`, a right part aligned to the end.
export function draw(g: Grid, x: number, y: number, width: number, list: Line[]): void {
  list.forEach((line, i) => {
    if (line.bg !== undefined) spans(g, x, y + i, [[' '.repeat(width), { bg: line.bg }]], width)
    const right = (line.right ?? []).reduce((n, [text]) => n + [...text].length, 0)
    const end = spans(g, x, y + i, line.spans, Math.max(0, width - (right ? right + 1 : 0)))
    if (right) spans(g, Math.max(end + 1, x + width - right), y + i, line.right ?? [], right)
  })
}

export function text(value: string, width: number, style: Style = {}, indent = ''): Line[] {
  return wrap(value, Math.max(1, width - indent.length)).map(one => ({
    spans: [[`${indent}${one}`, style]],
  }))
}

export function itemLine(item: RabeItem, now: number, isSelected = false): Line {
  const time = timeLabel(item, now)
  const right = item.status === 'running' ? time : `${item.status} ${time}`

  return {
    spans: [
      [isSelected ? '▌' : ' ', { fg: C.orange }],
      [glyph(item), { fg: tone(item) }],
      [` ${name(item)}`, { fg: item.status === 'running' ? C.text : C.dim }],
    ],
    right: [[`${right} `, { fg: C.dim }]],
    ...(isSelected && { bg: C.selected }),
    action: { key: `row:${item.id}`, action: { type: 'open', id: item.id } },
  }
}

// An item's title, status word and fact lines, then an empty line.
export function headLines(model: Model, item: RabeItem): Line[] {
  const f = facts(item, model.now, model.items)

  return [
    {
      spans: [
        [`${glyph(item)} `, { fg: tone(item) }],
        [f.title, { fg: C.bright }],
      ],
      right: [[f.status.slice(2), { fg: tone(item) }]],
    },
    ...f.lines.map(line => ({ spans: [[line, { fg: C.dim }]] as Span[] })),
    { spans: [] },
  ]
}
