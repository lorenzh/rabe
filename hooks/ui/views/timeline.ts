import type { RabeItem } from '../../model'
import { nextRun } from '../../schedule'
import { fit } from '../cells/grid'
import { C, CHIP, type Style, tone } from '../cells/palette'
import { clockTime, day, duration, tokens, usd } from '../format'
import { bar, byStart, glyph, KIND_LABEL, nameSpans, stable, tree } from '../lists'
import type { Drawn, Line, Model, View } from '../view'
import { beside, fitLine, focusOn, text } from './lines'

const dim = { fg: C.dim }
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
  const end = Math.min(now, item.endedAt ?? now)
  let at = schedule ? nextRun(schedule, Math.max(start, item.startedAt ?? item.seenAt)) : undefined
  for (let n = 0; at !== undefined && at <= end && n < width; n++) {
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

const MIN = 60_000
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map(one => one * MIN)

// The time axis: round clock times, at most four, spaced for the window, then
// `now`. A label that would repeat the one before it, run into it or into
// `now` is left out.
function axis(start: number, span: number, labelWidth: number, columns: number): string {
  const barWidth = columns - labelWidth
  const cells = Array<string>(columns).fill(' ')
  const put = (x: number, value: string) => {
    ;[...value].forEach((ch, i) => {
      if (x + i >= 0 && x + i < columns) cells[x + i] = ch
    })
  }
  const step = STEPS.find(one => span / one <= 4) ?? (STEPS.at(-1) as number)
  // Round in local time: the zone's offset from UTC at the start.
  const offset = new Date(start).getTimezoneOffset() * MIN
  let last = ''
  let end = labelWidth
  for (let at = Math.ceil((start - offset) / step) * step + offset; at < start + span; at += step) {
    const label = clockTime(at).slice(0, 5)
    const x = labelWidth + Math.round((barWidth * (at - start)) / span) - 2
    if (label === last || x < end || x + label.length > columns - 4) continue
    put(x, label)
    last = label
    end = x + label.length + 1
  }
  put(columns - 3, 'now')

  return cells.join('')
}

// The Timeline tab: a bar per item over the session with a legend and a time
// axis, then the tree of who started what beside (or above) the previous
// session in this project. The rows keep the order the pane opened with.
export const timelineView: View = (model, size, sel): Drawn => {
  const list = stable(model.items, sel.order?.timeline, byStart)
  const selected = list.find(item => item.id === sel.selected) ?? list[0]
  const start = Math.min(model.now - 60_000, ...list.map(item => item.startedAt ?? item.seenAt))
  const span = model.now - start
  const labelWidth = Math.min(24, Math.floor(size.columns / 3))
  const barWidth = size.columns - labelWidth
  const isSide = size.columns >= SIDE_COLUMNS
  const bars: Line[] = list.length
    ? list.map(item => {
        const name = fit(
          nameSpans(item)
            .map(([one]) => one)
            .join(''),
          labelWidth - 2,
        ).trimEnd()
        return {
          spans: [
            [item === selected ? '▌' : ' ', { fg: C.orange }],
            {
              key: `row:${item.id}`,
              label: name,
              action: { type: 'open', id: item.id },
              ...(item !== selected && { dim: true }),
            },
            [' '.repeat(labelWidth - 2 - [...name].length + 1)],
            [track(item, start, model.now, barWidth), { fg: color(item) }],
          ],
          ...(item === selected && { bg: C.selected }),
        }
      })
    : [{ spans: [[' Nothing ran yet.', dim]] }]
  const who = treeLines(model)
  const prev = previousLines(model, isSide ? BOX : size.columns)
  const below = isSide
    ? beside(who, size.columns - BOX - 2, [['  ']], prev, BOX)
    : [...who, { spans: [] }, ...prev].map(line => fitLine(line, size.columns))
  const lines: Line[] = [
    {
      spans: [
        ['WHEN DID THINGS RUN?', { fg: C.bright }],
        [`  this session, last ${Math.round(span / 60_000)} min`, dim],
      ],
    },
    { spans: LEGEND.flatMap(([label, chip]) => [[` ${label} `, chip], [' ']]) },
    { spans: [] },
    { spans: [[axis(start, span, labelWidth, size.columns), dim]] },
    ...focusOn(bars, selected?.id ?? ''),
    { spans: [] },
  ]

  return { nodes: [...lines.map(line => fitLine(line, size.columns)), ...below], buttons: [] }
}
