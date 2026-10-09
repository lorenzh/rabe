import type { RabeItem } from '../../model'
import { grid, type Span, spans, vline } from '../cells/grid'
import { C, type Style, tone } from '../cells/palette'
import { facts } from '../facts'
import { tokens, usd } from '../format'
import { type Group, glyph, grouped, groupNote, groupOf, matches, timeLabel } from '../lists'
import {
  canStop,
  type Drawn,
  type Model,
  type Selection,
  type Size,
  type View,
  type ViewButton,
  type ViewInput,
} from '../view'
import { bodyLines } from './detail'
import { draw, headLines, itemLine, type Line } from './lines'

const GROUP_COLOR: Record<Group, number> = {
  failed: C.red,
  agents: C.orange,
  shells: C.yellow,
  monitors: C.blue,
  cron: C.purple,
}

// The split needs room for both columns; below this the detail opens in place.
export const SPLIT_COLUMNS = 90

export function isSplit(size: Size): boolean {
  return size.surface === 'terminal' && size.columns >= SPLIT_COLUMNS
}

const plainLine = (item: RabeItem, now: number): Line => {
  const d = item.detail as Record<string, unknown>
  const time = timeLabel(item, now)
  const parts = [
    `${glyph(item)} ${item.title}`,
    d.port !== undefined && `:${d.port}`,
    item.status === 'failed' && d.exitCode !== undefined && `exit ${d.exitCode}`,
    item.status === 'running' ? time : `${item.status} ${time}`,
  ]

  return {
    spans: [[parts.filter(Boolean).join(' · ')]],
    action: { key: `row:${item.id}`, action: { type: 'open', id: item.id } },
  }
}

// The items in list order, groups folded or not, with the ones the list shows.
// Off the terminal each line is plain text, since the renderer draws it as a
// Button. Gaps between groups only where the whole list fits in `rows`.
function listLines(
  model: Model,
  sel: Selection,
  size: Size,
  rows: number,
): { lines: Line[]; order: RabeItem[] } {
  const isTerminal = size.surface === 'terminal'
  const visible = model.items.filter(item => matches(item, sel.query))
  const groups = grouped(visible)
  const order = groups.flatMap(group => (sel.folded.includes(group.id) ? [] : group.items))
  const selected = selectedItem(order, sel)
  const blocks = groups.map(group => {
    const isFolded = sel.folded.includes(group.id)
    const action = { key: `group-${group.id}`, action: { type: 'fold', group: group.id } as const }
    const count = String(group.items.length)
    const head: Line = isTerminal
      ? {
          spans: [
            [`${isFolded ? '▸' : '▾'} ${group.label.toUpperCase()}`, { fg: GROUP_COLOR[group.id] }],
            [` ${groupNote(group.id, group.items) || count}`, { fg: C.dim }],
          ],
          action,
        }
      : { spans: [[`${group.label} ${count}${isFolded ? ' · folded' : ''}`]], action }
    const items = isFolded ? [] : group.items
    return [
      head,
      ...items.map(item =>
        isTerminal ? itemLine(item, model.now, item === selected) : plainLine(item, model.now),
      ),
    ]
  })
  const spaced = blocks.flatMap((block, i) => (i > 0 ? [{ spans: [] }, ...block] : block))
  const lines = isTerminal && spaced.length <= rows ? spaced : blocks.flat()

  return { lines, order }
}

export function selectedItem(order: RabeItem[], sel: Selection): RabeItem | undefined {
  return order.find(item => item.id === sel.selected) ?? order[0]
}

// Keeps the selected line in a window of `rows` lines.
function windowed(lines: Line[], rows: number): Line[] {
  const at = lines.findIndex(line => line.bg !== undefined)
  const start = Math.max(0, Math.min(at - rows + 2, lines.length - rows))

  return lines.slice(start, start + rows)
}

export function summary(model: Model, item: RabeItem, rows: number, width: number): Line[] {
  const head = headLines(model, item)

  return [...head, ...bodyLines(model, item, width).slice(-Math.max(0, rows - head.length))]
}

// The selected item in one line under a list too narrow for the split.
function summaryLine(model: Model, item: RabeItem): Line {
  const d = item.detail as Record<string, unknown>
  const dim = { fg: C.dim }
  const parts: Span[] = []
  const add = (text: string, style: Style = dim) => parts.push([' · ', dim], [text, style])
  if (d.port !== undefined) add(`:${d.port}`, { fg: C.blue })
  if (typeof d.model === 'string') add(d.model)
  if (item.costUsd !== undefined) add(`≈ ${usd(item.costUsd)}`, { fg: C.bright })
  if (item.tokens) add(`${tokens(item.tokens.input)} in`)
  add(facts(item, model.now, model.items).status.slice(2), { fg: tone(item) })

  return {
    spans: [[glyph(item), { fg: tone(item) }], [' '], [item.title, { fg: C.bright }], ...parts],
    bg: C.panel,
  }
}

// List keys. j and k stay bound at the ends: a letter no Button binds moves
// the keys to the prompt. Below the split, j, k and s keep only their letter.
function listButtons(model: Model, size: Size, selected: RabeItem | undefined, order: RabeItem[]) {
  const isTerminal = size.surface === 'terminal'
  const short = isTerminal && !isSplit(size)
  const label = (key: string, word: string) => (short ? key : `${key}: ${word}`)
  const buttons: ViewButton[] = []
  const at = selected ? order.indexOf(selected) : -1
  const next = order[Math.min(at + 1, order.length - 1)]
  const prev = order[Math.max(at - 1, 0)]
  if (isTerminal && selected && next && prev) {
    buttons.push(
      {
        key: 'down',
        label: label('j', 'down'),
        hotkey: 'j',
        action: { type: 'select', id: next.id },
      },
      { key: 'up', label: label('k', 'up'), hotkey: 'k', action: { type: 'select', id: prev.id } },
      { key: 'open', label: 'open', autoFocus: true, action: { type: 'open', id: selected.id } },
    )
  }
  if (selected && canStop(selected)) {
    buttons.push({
      key: 'stop',
      label: 'x: stop',
      hotkey: 'x',
      action: { type: 'stop', ids: [selected.id] },
    })
  }
  const group = selected
    ? model.items
        .filter(one => groupOf(one) === groupOf(selected) && canStop(one))
        .map(one => one.id)
    : []
  if (group.length > 1) {
    buttons.push({
      key: 'stop-group',
      label: 'g: stop group',
      hotkey: 'g',
      action: { type: 'stop', ids: group },
    })
  }
  if (size.hasInput) {
    buttons.push({
      key: 'find',
      label: label('s', 'search'),
      hotkey: 's',
      action: { type: 'focus', key: 'search' },
    })
  }

  return buttons
}

const search = (sel: Selection): ViewInput => ({
  key: 'search',
  label: 'search',
  placeholder: 'title, kind or command',
  submitLabel: 'filter',
  value: sel.query,
  isLive: true,
  action: text => ({ type: 'query', text }),
})

// The Items tab: the grouped list, and beside it (split) or under it (one
// line) the selected item. Enter opens the full detail in place.
export const itemsView: View = (model, size, sel): Drawn => {
  let g = grid(size.columns, size.rows)
  const inputs = size.hasInput ? [search(sel)] : []
  if (model.items.length === 0) {
    spans(g, 1, 0, [['Nothing runs in the background.', { fg: C.dim }]])
    return { grid: g, buttons: [], inputs }
  }
  const split = isSplit(size)
  const hasSummary = size.surface === 'terminal' && !split
  const listRows = hasSummary ? Math.max(1, size.rows - 2) : size.rows
  const { lines, order } = listLines(model, sel, size, listRows)
  const selected = selectedItem(order, sel)
  const buttons = listButtons(model, size, selected, order)
  if (lines.length === 0) {
    spans(g, 1, 0, [[`No item matches "${sel.query}".`, { fg: C.dim }]])
    return { grid: g, buttons, inputs }
  }
  const listWidth = split ? Math.min(48, Math.floor(size.columns * 0.42)) : size.columns
  const shown = windowed(lines, selected ? listRows : size.rows)
  // Off the terminal each row is a Text or a Button, so the grid ends with the list.
  if (size.surface !== 'terminal') g = grid(size.columns, shown.length)
  draw(g, 0, 0, listWidth, shown)
  if (selected && split) {
    vline(g, listWidth, 0, size.rows, { fg: C.rule })
    const x = listWidth + 2
    draw(g, x, 0, size.columns - x, summary(model, selected, size.rows, size.columns - x))
  } else if (selected && hasSummary) {
    draw(g, 0, size.rows - 1, size.columns, [summaryLine(model, selected)])
  }
  const rows: Drawn['rows'] = {}
  shown.forEach((line, y) => {
    if (line.action) rows[y] = line.action
  })

  return { grid: g, buttons, inputs, rows }
}
