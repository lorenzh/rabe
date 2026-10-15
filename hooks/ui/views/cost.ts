import type { RabeGrouping } from '../../../types'
import type { RabeItem } from '../../model'
import { bar, fit } from '../cells/grid'
import { C, CHIP, type Style, tone } from '../cells/palette'
import { duration, short, tokens, usd, validId } from '../format'
import { type GroupRow, groupRows, heldRows, mainTotal } from '../groups'
import { byTokens, cost, glyph, shown, stable, tokenSum, totals, withForwarder } from '../lists'
import type { Drawn, Line, Model, Part, View, ViewButton } from '../view'
import { resumeButton } from './detail'
import { fitLine, focusOn } from './lines'

const dim = { fg: C.dim }
const LONG_TOOL = 2 * 60_000
const STUCK = 5 * 60_000
// The widths of TOKENS, COST and TIME or WORKERS, right-aligned. The groupings
// have a wider last column (it holds `WORKERS`, then a space) and, in a pane
// under 44 columns, narrower number columns so the numbers still fit.
type Widths = { tokens: number; cost: number; last: number }

function widths(by: RabeGrouping, columns: number): Widths {
  if (by === 'agent' && columns >= 44) return { tokens: 8, cost: 9, last: 7 }

  return columns >= 44 ? { tokens: 8, cost: 9, last: 8 } : { tokens: 7, cost: 8, last: 6 }
}

function barStyle(item: RabeItem): Style {
  if (item.status === 'failed') return { fg: C.red }
  if (item.status === 'done') return { fg: C.green }
  if (item.status === 'stopped' || item.status === 'idle') return dim

  return { fg: CHIP[item.kind].fg }
}

function workerLine(
  item: RabeItem,
  max: number,
  now: number,
  nameWidth: number,
  barWidth: number,
  isSelected: boolean,
  columns: number,
  w: Widths,
): Line[] {
  const tok = tokenSum(item)
  const time = item.startedAt === undefined ? 'n/a' : short((item.endedAt ?? now) - item.startedAt)
  const blocks = tok < 0 ? '▏'.padEnd(barWidth) : bar(tok, max, barWidth)
  const title = item.status === 'idle' ? `idle ${item.title}` : item.title
  // A narrow pane stacks a row whose name does not fit: name above, numbers below.
  const stacked = columns < 60 && [...title].length > nameWidth - 3
  const name = stacked ? fit(title, columns - 3).trimEnd() : fit(title, nameWidth - 3).trimEnd()
  const bg = isSelected ? { bg: C.selected } : {}
  const numbers: Line['spans'] = [
    [barWidth ? ` ${blocks}` : '', tok < 0 ? dim : barStyle(item)],
    [(tok < 0 ? 'n/a' : tokens(tok)).padStart(w.tokens), tok < 0 ? dim : {}],
    [cost(item.costUsd).padStart(w.cost), item.costUsd === undefined ? dim : {}],
    [time.padStart(w.last)],
  ]
  const lead: Line['spans'] = [
    [isSelected ? '▌' : ' ', { fg: C.orange }],
    [glyph(item), { fg: tone(item) }],
    [' '],
    {
      key: `row:${item.id}`,
      label: name,
      action: { type: 'open', id: item.id },
      ...(!isSelected && { dim: true as const }),
    },
  ]
  if (stacked) {
    return [
      { spans: lead, ...bg },
      { spans: [[' '.repeat(3)], ...numbers], joins: true, ...bg },
    ]
  }

  return [{ spans: [...lead, [' '.repeat(nameWidth - 3 - [...name].length)], ...numbers], ...bg }]
}

// Dim text on as many lines as `columns` needs, broken at spaces.
function wrapText(text: string, columns: number, lead: string): Line[] {
  const out: string[] = []
  for (const word of text.split(' ')) {
    const last = out.at(-1)
    if (last !== undefined && [...last].length + 1 + [...word].length <= columns) {
      out[out.length - 1] = `${last} ${word}`
    } else out.push(`${lead}${word}`)
  }

  return out.map(line => ({ spans: [[line, dim]] }))
}

// `text` in `room` cells: the start and the end, the middle cut to `…`.
function middle(text: string, room: number): string {
  const chars = [...text]
  if (chars.length <= room) return text
  if (room < 3) return chars.slice(-Math.max(0, room)).join('')
  const head = Math.floor((room - 1) / 2)

  return `${chars.slice(0, head).join('')}…${chars.slice(head + 1 - room).join('')}`
}

// A row of the model and harness groupings, or the main session's row. When
// the name and its "(partial)" marker do not fit the name column, the numbers
// move to a second line: no value is dropped to keep a name.
function groupLine(
  row: GroupRow,
  max: number,
  nameWidth: number,
  barWidth: number,
  isSelected: boolean,
  columns: number,
  w: Widths,
): Line[] {
  const blocks = row.tokens < 0 ? '▏'.padEnd(barWidth) : bar(row.tokens, max, barWidth)
  // A total that leaves some workers out says so in words.
  const tag = row.isPartial ? ' (partial)' : ''
  const room = Math.max(0, nameWidth - 3)
  const full = `${row.title}${tag}`
  const stacked = [...full].length > room
  // Stacked rows shorten the shared lead to "main · " and drop "claude-". A
  // name still too long for the line loses its middle, so the marker and the
  // end that tells two models apart stay.
  const title = row.title.replace(/^main session · /, 'main · ').replace(/^claude-/, '')
  const name = stacked ? middle(title, columns - 3 - tag.length) + tag : full
  const key = `row:${row.id}`
  const bg = isSelected ? { bg: C.selected } : {}
  const numbers: Line['spans'] = [
    [barWidth ? ` ${blocks}` : '', row.tokens < 0 ? dim : { fg: C.orange }],
    [(row.tokens < 0 ? 'n/a' : tokens(row.tokens)).padStart(w.tokens), row.tokens < 0 ? dim : {}],
    [cost(row.costUsd).padStart(w.cost), row.costUsd === undefined ? dim : {}],
    [(row.count === undefined ? '' : `${row.count}`).padStart(w.last)],
  ]
  const label = {
    key,
    label: name,
    action: { type: 'focus' as const, key },
    ...(!isSelected && { dim: true as const }),
  }
  const lead: Line['spans'] = [[isSelected ? '▌' : ' ', { fg: C.orange }], ['•', dim], [' '], label]
  if (stacked) {
    return [
      { spans: lead, ...bg },
      { spans: [[' '.repeat(3)], ...numbers], joins: true, ...bg },
    ]
  }

  return [
    { spans: [...lead, [' '.repeat(Math.max(0, room - [...name].length))], ...numbers], ...bg },
  ]
}

const GROUPINGS: { by: RabeGrouping; key: string }[] = [
  { by: 'agent', key: 'i' },
  { by: 'model', key: 'o' },
  { by: 'harness', key: 'h' },
]

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
// bar each, and the agents that look slow. While the pane is open the order
// is held (`stable`), so a row does not move as its tokens grow.
export const costView: View = (model, size, sel): Drawn => {
  const sum = totals(model.items)
  const running = model.items.filter(item => item.status === 'running').length
  // An agent that only forwarded to Codex counts in its job's row.
  const workers = shown(model.items)
    .filter(item => item.kind === 'agent' || item.kind === 'codex')
    .map(item => withForwarder(item, model.items))
  const by = sel.grouping ?? 'agent'
  const main = model.mainUsage ?? {}
  const items = stable(workers, sel.order?.cost, byTokens)
  // The rows by id: a worker's row has its item's id, a group's its own.
  const rows: GroupRow[] =
    by === 'agent'
      ? [mainTotal('agent', main)].flatMap(row => (row ? [row] : []))
      : heldRows(groupRows(by, model.items, main), sel.order?.[`cost:${by}`])
  const list = by === 'agent' ? items : []
  const ids =
    by === 'agent'
      ? [...items.map(item => item.id), ...rows.map(row => row.id)]
      : rows.map(row => row.id)
  const pickedId = ids.includes(sel.selected) ? sel.selected : (ids[0] ?? '')
  const w = widths(by, size.columns)
  const right = w.tokens + w.cost + w.last
  // A grouping row stacks when its name does not fit, so its name column may
  // shrink to keep the number columns whole in the narrowest pane.
  const least = Math.min(12, Math.max(5, size.columns - right))
  const nameWidth = Math.max(least, Math.min(36, size.columns - right - 12))
  const room = size.columns - nameWidth - right - 1
  const barWidth = room >= 4 ? room : 0
  const max = Math.max(1, ...list.map(tokenSum), ...rows.map(row => row.tokens))
  const session = model.usd === undefined ? 'session cost n/a' : `≈ ${usd(model.usd)} session`
  const sortLabel = sel.order?.cost ? 'tokens when opened' : 'tokens'
  const unit = by === 'agent' ? 'worker' : by
  const parts: Part[][] = [[[` ${session} `, { fg: C.bright }]]]
  if (model.items.some(item => item.kind === 'agent')) {
    parts.push([
      [' claude ', dim],
      [cost(sum.claude), { fg: C.orange }],
    ])
  }
  if (model.items.some(item => item.kind === 'codex')) {
    parts.push([
      ['  codex ', dim],
      [cost(sum.codex), { fg: C.cyan }],
    ])
  }
  parts.push([
    ['  tokens ', dim],
    [tokens(sum.tokens), { fg: C.bright }],
  ])
  parts.push([
    ['  running ', dim],
    [String(running), { fg: C.yellow }],
  ])
  if (sum.unknown) parts.push([[`  ${sum.unknown} n/a`, dim]])
  // One line where it fits; a narrow pane wraps whole parts onto more lines.
  const textWidth = (part: Part[]) =>
    part.reduce((n, one) => n + [...('key' in one ? one.label : String(one[0]))].length, 0)
  const wrapped: Part[][] = []
  for (const part of parts) {
    const last = wrapped.at(-1)
    if (last && textWidth(last) + textWidth(part) <= size.columns) last.push(...part)
    else wrapped.push([...part])
  }
  const head: Line[] = [
    ...wrapped.map(spans => ({ bg: C.panel, spans })),
    { spans: [[` session ${validId(model.sessionId) ? model.sessionId : 'n/a'}`, dim]] },
    ...wrapText(`by ${unit} · sorted by ${sortLabel}`, size.columns, ''),
    {
      spans: [
        [
          `${fit(nameWidth < 6 ? ' NAME' : '  NAME', nameWidth)}${' '.repeat(barWidth ? barWidth + 1 : 0)}${'TOKENS'.padStart(w.tokens)}${'COST'.padStart(w.cost)}${(by === 'agent' ? 'TIME' : w.last > 6 ? 'WORKERS' : 'COUNT').padStart(w.last)}`,
          dim,
        ],
      ],
    },
  ]
  const free = model.items.some(
    item => item.kind === 'shell' || item.kind === 'monitor' || item.kind === 'cron',
  )
  const after: Line[] = [
    ...(free ? wrapText('shells, monitors and cron jobs use no tokens', size.columns, ' ') : []),
    { spans: [] },
    { spans: [['LOAD', { fg: C.bright }]] },
    ...loadLines(model),
  ]
  const drawn: Line[] = [
    ...list.flatMap(item =>
      workerLine(item, max, model.now, nameWidth, barWidth, item.id === pickedId, size.columns, w),
    ),
    ...rows.flatMap(row =>
      groupLine(row, max, nameWidth, barWidth, row.id === pickedId, size.columns, w),
    ),
  ]
  const body: Line[] = drawn.length ? drawn : [{ spans: [[' No agent or Codex job yet.', dim]] }]
  const isGone = model.items.some(item => item.kind === 'codex' && item.detail.isSessionMissing)
  const foot = [
    'session cost as /cost totals it',
    Object.keys(main).length > 0 &&
      'main session: steps since Rabe loaded, cache writes at the 1-hour rate',
    isGone && 'n/a: a Codex session file is gone',
  ]
  const lines = [
    ...head,
    ...focusOn(body, pickedId),
    ...after,
    { spans: [] },
    ...wrapText(foot.filter(Boolean).join(' · '), size.columns, ''),
  ]

  const id = model.sessionId
  const buttons: ViewButton[] = GROUPINGS.map(one => ({
    key: `by-${one.by}`,
    label: `${one.key}: ${one.by}`,
    hotkey: one.key,
    action: { type: 'group', by: one.by },
  }))
  if (validId(id)) buttons.push(resumeButton(`claude --resume ${id}`, id))

  return { nodes: lines.map(line => fitLine(line, size.columns)), buttons }
}
