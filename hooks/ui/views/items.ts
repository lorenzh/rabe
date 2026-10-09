import type { RabeItem } from '../../model'
import type { Span } from '../cells/grid'
import { C, type Style, tone } from '../cells/palette'
import { facts } from '../facts'
import { tokens, usd } from '../format'
import { type Group, glyph, grouped, groupNote, groupOf, matches } from '../lists'
import {
  canStop,
  type Drawn,
  type Line,
  type Model,
  type Selection,
  type Size,
  type View,
  type ViewButton,
  type ViewInput,
} from '../view'
import { detailLines } from './detail'
import { beside, fitLine, focusOn, itemLine, plain } from './lines'

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
  return size.columns >= SPLIT_COLUMNS
}

// The items in list order, groups folded or not, with the lines the list
// shows: a header per group (a Button that folds it) and a row per item.
// Gaps between groups only where the whole list fits in `rows`.
function listLines(
  model: Model,
  sel: Selection,
  rows: number,
): { lines: Line[]; order: RabeItem[] } {
  const visible = model.items.filter(item => matches(item, sel.query))
  const groups = grouped(visible, sel.order)
  const order = groups.flatMap(group => (sel.folded.includes(group.id) ? [] : group.items))
  const selected = selectedItem(order, sel)
  const blocks = groups.map((group): Line[] => {
    const isFolded = sel.folded.includes(group.id)
    const head: Line = {
      spans: [
        [`${isFolded ? '▸' : '▾'} `, { fg: GROUP_COLOR[group.id] }],
        {
          key: `group-${group.id}`,
          label: group.label.toUpperCase(),
          action: { type: 'fold', group: group.id },
        },
        [` ${groupNote(group.id, group.items) || group.items.length}`, { fg: C.dim }],
      ],
    }
    const items = isFolded ? [] : group.items
    return [head, ...items.map(item => itemLine(item, model.now, item === selected))]
  })
  const spaced = blocks.flatMap((block, i) => (i > 0 ? [{ spans: [] }, ...block] : block))
  const lines = spaced.length <= rows ? spaced : blocks.flat()

  return { lines: focusOn(lines, selected?.id ?? ''), order }
}

export function selectedItem(order: RabeItem[], sel: Selection): RabeItem | undefined {
  return order.find(item => item.id === sel.selected) ?? order[0]
}

export const summary = detailLines

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

// List keys under the list; the rows themselves take the arrows and Enter.
// Below the split, s keeps only its letter.
function listButtons(model: Model, size: Size, selected: RabeItem | undefined) {
  const buttons: ViewButton[] = []
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
      label: isSplit(size) ? 's: search' : 's',
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
// line) the selected item. Enter on a row opens the full detail in place.
export const itemsView: View = (model, size, sel): Drawn => {
  const inputs = size.hasInput ? [search(sel)] : []
  const note = (value: string, buttons: ViewButton[] = []): Drawn => ({
    nodes: [fitLine({ spans: [[value, { fg: C.dim }]] }, size.columns)],
    buttons,
    inputs,
  })
  if (model.items.length === 0) return note(' Nothing runs in the background.')
  const split = isSplit(size)
  const { lines, order } = listLines(model, sel, split ? size.rows : size.rows - 2)
  const selected = selectedItem(order, sel)
  const buttons = listButtons(model, size, selected)
  if (lines.length === 0) return note(` No item matches "${sel.query}".`, buttons)
  if (selected && split) {
    const listWidth = Math.min(48, Math.floor(size.columns * 0.42))
    const right = size.columns - listWidth - 2
    const detail = summary(model, selected, size.rows, right, sel).map(plain)
    const rule: Span[] = [['│', { fg: C.rule }], [' ']]
    const rows = Math.max(lines.length, detail.length, size.rows)
    const left = [...lines, ...Array.from({ length: rows - lines.length }, () => ({ spans: [] }))]

    return { nodes: beside(left, listWidth, rule, detail, right), buttons, inputs }
  }
  const nodes = lines.map(line => fitLine(line, size.columns))
  if (selected) {
    const pad = Math.max(0, size.rows - 1 - nodes.length)
    nodes.push(...Array.from({ length: pad }, () => ({ spans: [] })))
    nodes.push(fitLine(summaryLine(model, selected), size.columns))
  }

  return { nodes, buttons, inputs }
}
