import type { RabeItem } from '../../model'
import { nextRun } from '../../schedule'
import { fit, grid, spans } from '../cells/grid'
import { C, CHIP, type Style, tone } from '../cells/palette'
import { clockTime, day, duration, tokens, usd } from '../format'
import { bar, glyph, KIND_LABEL, nameSpans, tree } from '../lists'
import type { Drawn, Model, View } from '../view'
import { draw, type Line, moveButtons, text, windowStart } from './lines'

const dim = { fg: C.dim }
const HEAD = 4
const BOX = 40
const SIDE_COLUMNS = 90

const LEGEND: [string, Style][] = [
  ['shell', CHIP.shell],
  ['claude', CHIP.agent],
  ['codex', CHIP.codex],
  ['monitor', CHIP.monitor],
  ['cron run', CHIP.cron],
  ['done', CHIP.done],
  ['failed', CHIP.failed],
]

const COUNTS: [RabeItem['kind'], string, string][] = [
  ['agent', 'agent', 'agents'],
  ['codex', 'codex', 'codex'],
  ['workflow', 'workflow', 'workflows'],
  ['shell', 'shell', 'shells'],
  ['monitor', 'monitor', 'monitors'],
]

function color(item: RabeItem): number {
  if (item.status === 'failed') return C.red
  if (item.status === 'done') return C.green
  if (item.status === 'stopped') return C.dim

  return CHIP[item.kind].fg
}

// One cell per slice of the window: a bar over the run, or for a cron job a
// tick at each run its schedule had since Rabe saw it (jitter not counted).
function track(item: RabeItem, start: number, now: number, width: number): string {
  if (item.kind !== 'cron') {
    return bar(item.startedAt ?? item.seenAt, item.endedAt ?? now, start, now, width)
  }
  const cells = Array<string>(width).fill(' ')
  const schedule = item.detail.schedule
  const span = Math.max(1, now - start)
  let at = schedule ? nextRun(schedule, Math.max(start, item.startedAt ?? item.seenAt)) : undefined
  for (let n = 0; at !== undefined && at <= now && n < width; n++) {
    cells[Math.min(width - 1, Math.floor(((at - start) / span) * width))] = '█'
    at = nextRun(schedule as string, at)
  }

  return cells.join('')
}

function treeLines(model: Model): Line[] {
  return [
    {
      spans: [
        ['WHO STARTED WHAT?', { fg: C.bright }],
        ['  agents and their children', dim],
      ],
    },
    { spans: [['main session']] },
    ...tree(model.items).map(
      (line): Line => ({
        spans: [
          [line.prefix, dim],
          [`${glyph(line.item)} `, { fg: tone(line.item) }],
          [line.item.title],
          [line.item.kind === 'agent' ? '' : ` (${KIND_LABEL[line.item.kind]})`, dim],
        ],
      }),
    ),
  ]
}

function previousLines(model: Model, width: number): Line[] {
  const prev = model.previous
  const head: Line = { spans: [[' PREVIOUS SESSION', { fg: C.bright }]] }
  if (!prev) {
    return [
      head,
      ...text('No earlier session with background work in this project.', width, dim, ' '),
    ]
  }
  const counts = COUNTS.flatMap(([kind, one, many]) => {
    const n = prev.counts[kind] ?? 0
    return n ? [`${n} ${n === 1 ? one : many}`] : []
  })
  const crons = prev.counts.cron ?? 0
  const spend = [
    `${tokens(prev.tokens)} tok`,
    ...(prev.startedAt === undefined ? [] : [duration(prev.endedAt - prev.startedAt)]),
  ]
  const failed = prev.failed
    .slice(0, 2)
    .map((title): Line => ({ spans: [[' ✗ failed', { fg: C.red }], [` ${title}`]] }))
  const more = prev.failed.length - failed.length

  const out: Line[] = [
    head,
    { spans: [[` this project · ended ${day(prev.endedAt, model.now)}`, dim]] },
    { spans: [[' ✓', { fg: C.green }], [` ${counts.join(' · ') || 'no items'}`]] },
    {
      spans: [
        [` ${prev.usd === undefined ? 'cost n/a' : `≈ ${usd(prev.usd)}`}`, { fg: C.bright }],
        [` · ${spend.join(' · ')}`, dim],
      ],
    },
    ...failed,
    ...(more ? [{ spans: [[` +${more} more failed`, dim]] } as Line] : []),
    ...(crons
      ? [
          {
            spans: [
              [' ⟳', { fg: C.purple }],
              [` ${crons} cron job${crons === 1 ? '' : 's'} ended with the session`, dim],
            ],
          } as Line,
        ]
      : []),
  ]

  return out.map(line => ({ ...line, bg: C.raised }))
}

// The Timeline tab: a bar per item over the session with a legend and a time
// axis, then the tree of who started what beside (or above) the previous
// session in this project.
export const timelineView: View = (model, size, sel): Drawn => {
  const g = grid(size.columns, size.rows)
  const list = model.items.toSorted((a, b) => (a.startedAt ?? a.seenAt) - (b.startedAt ?? b.seenAt))
  const selected = list.find(item => item.id === sel.selected) ?? list[0]
  const start = Math.min(model.now - 60_000, ...list.map(item => item.startedAt ?? item.seenAt))
  const span = model.now - start
  const labelWidth = Math.min(24, Math.floor(size.columns / 3))
  const barWidth = size.columns - labelWidth
  const isSide = size.columns >= SIDE_COLUMNS
  const who = treeLines(model)
  const prev = previousLines(model, isSide ? BOX : size.columns)
  const below = isSide ? Math.max(who.length, prev.length) : who.length + 1 + prev.length
  const room = Math.max(3, size.rows - HEAD - 1 - below)
  const first = windowStart(list.length, selected ? list.indexOf(selected) : 0, room)
  const bars: Line[] = list.length
    ? list.slice(first, first + room).map(item => ({
        spans: [
          [item === selected ? '▌' : ' ', { fg: C.orange }],
          [
            fit(
              nameSpans(item)
                .map(([text]) => text)
                .join(''),
              labelWidth - 2,
            ),
          ],
          [' '],
          [track(item, start, model.now, barWidth), { fg: color(item) }],
        ],
        ...(item === selected && { bg: C.selected }),
        action: { key: `row:${item.id}`, action: { type: 'open', id: item.id } },
      }))
    : [{ spans: [[' Nothing ran yet.', dim]] }]

  draw(g, 0, 0, size.columns, [
    {
      spans: [
        ['WHEN DID THINGS RUN?', { fg: C.bright }],
        [`  this session, last ${Math.round(span / 60_000)} min`, dim],
      ],
    },
    { spans: LEGEND.flatMap(([label, chip]) => [[` ${label} `, chip], [' ']]) },
  ])
  for (const quarter of [1, 2, 3]) {
    const x = labelWidth + Math.round((barWidth * quarter) / 4) - 2
    spans(g, x, 3, [[clockTime(start + (span * quarter) / 4).slice(0, 5), dim]])
  }
  spans(g, size.columns - 3, 3, [['now', dim]])
  draw(g, 0, HEAD, size.columns, bars)
  const y = HEAD + bars.length + 1
  if (isSide) {
    draw(g, 0, y, size.columns - BOX - 2, who)
    draw(g, size.columns - BOX, y, BOX, prev)
  } else {
    draw(g, 0, y, size.columns, [...who, { spans: [] }, ...prev])
  }
  const rows: Drawn['rows'] = {}
  bars.forEach((line, i) => {
    if (line.action) rows[HEAD + i] = line.action
  })

  return { grid: g, buttons: moveButtons(list, selected), rows }
}
