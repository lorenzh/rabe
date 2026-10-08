import type { RabeItem } from '../../model'
import { grid, spans, vline } from '../cells/grid'
import { C } from '../cells/palette'
import { facts } from '../facts'
import { type Group, grouped, groupNote, groupOf, matches } from '../lists'
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

// The items in list order, groups folded or not, with the ones the list shows.
function listLines(model: Model, sel: Selection): { lines: Line[]; order: RabeItem[] } {
  const visible = model.items.filter(item => matches(item, sel.query))
  const groups = grouped(visible)
  const order = groups.flatMap(group => (sel.folded.includes(group.id) ? [] : group.items))
  const selected = selectedItem(order, sel)
  const lines: Line[] = []
  for (const group of groups) {
    const isFolded = sel.folded.includes(group.id)
    if (lines.length > 0) lines.push({ spans: [] })
    lines.push({
      spans: [
        [`${isFolded ? '▸' : '▾'} ${group.label.toUpperCase()}`, { fg: GROUP_COLOR[group.id] }],
        [` ${group.items.length}`, { fg: C.dim }],
        [
          groupNote(group.id, group.items) ? `  ${groupNote(group.id, group.items)}` : '',
          { fg: C.dim },
        ],
      ],
      action: { key: `group-${group.id}`, action: { type: 'fold', group: group.id } },
    })
    if (isFolded) continue
    for (const item of group.items) lines.push(itemLine(item, model.now, item === selected))
  }

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

function listButtons(model: Model, size: Size, selected: RabeItem | undefined, order: RabeItem[]) {
  const buttons: ViewButton[] = []
  const at = selected ? order.indexOf(selected) : -1
  const next = order[at + 1]
  const prev = order[at - 1]
  if (next)
    buttons.push({
      key: 'down',
      label: 'j: down',
      hotkey: 'j',
      action: { type: 'select', id: next.id },
    })
  if (prev)
    buttons.push({
      key: 'up',
      label: 'k: up',
      hotkey: 'k',
      action: { type: 'select', id: prev.id },
    })
  if (selected) {
    buttons.push({
      key: 'open',
      label: 'enter: open',
      autoFocus: true,
      action: { type: 'open', id: selected.id },
    })
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
      label: 's: search',
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
  const g = grid(size.columns, size.rows)
  const inputs = size.hasInput ? [search(sel)] : []
  if (model.items.length === 0) {
    spans(g, 1, 0, [['Nothing runs in the background.', { fg: C.dim }]])
    return { grid: g, buttons: [], inputs }
  }
  const { lines, order } = listLines(model, sel)
  const selected = selectedItem(order, sel)
  const buttons = listButtons(model, size, selected, order)
  if (lines.length === 0) {
    spans(g, 1, 0, [[`No item matches "${sel.query}".`, { fg: C.dim }]])
    return { grid: g, buttons, inputs }
  }
  const split = isSplit(size)
  const listWidth = split ? Math.min(48, Math.floor(size.columns * 0.42)) : size.columns
  const listRows = split || !selected ? size.rows : size.rows - 1
  const shown = windowed(lines, listRows)
  draw(g, 0, 0, listWidth, shown)
  if (selected && split) {
    vline(g, listWidth, 0, size.rows, { fg: C.rule })
    const x = listWidth + 2
    draw(g, x, 0, size.columns - x, summary(model, selected, size.rows, size.columns - x))
  } else if (selected) {
    const f = facts(selected, model.now, model.items)
    spans(g, 1, size.rows - 1, [
      [[selected.title, f.lines[0], f.status].join(' · '), { fg: C.dim }],
    ])
  }
  const rows: Drawn['rows'] = {}
  shown.forEach((line, y) => {
    if (line.action) rows[y] = line.action
  })

  return { grid: g, buttons, inputs, rows }
}
