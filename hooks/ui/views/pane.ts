import type { RabeTab } from '../../../types'
import { grid, hline, paste, spans } from '../cells/grid'
import { C } from '../cells/palette'
import {
  controlRows,
  type Drawn,
  type Selection,
  type Size,
  type View,
  type ViewButton,
} from '../view'
import { costView } from './cost'
import { detailView } from './detail'
import { effectsView } from './effects'
import { isSplit, itemsView } from './items'
import { timelineView } from './timeline'

// Each tab's view. A new tab adds its view here and its name to RabeTab.
export const TABS: { tab: RabeTab; label: string; hotkey: string; view: View }[] = [
  { tab: 'items', label: 'Items', hotkey: '1', view: itemsView },
  { tab: 'cost', label: 'Cost', hotkey: '2', view: costView },
  { tab: 'effects', label: 'Effects', hotkey: '3', view: effectsView },
  { tab: 'timeline', label: 'Timeline', hotkey: '4', view: timelineView },
]

const HEAD = 2
const HINT = 1

// The hint names the keys the tab's Buttons bind.
const WORDS: Record<string, string> = {
  down: 'j/k move',
  open: 'enter open',
  stop: 'x stop',
  'stop-group': 'g stop group',
}

function hint(sel: Selection, isOpen: boolean, buttons: ViewButton[]): string {
  if (!sel.isFocused) return 'tab to select · esc close'
  if (isOpen) return 'b back · esc close'
  return [...buttons.flatMap(one => WORDS[one.key] ?? []), 'esc close'].join(' · ')
}

// The whole pane: the tab row and its rule, the tab's view (or the open item's
// detail), and the hint, sized so the grid and the controls under it fill
// `size.rows` without scrolling. Off the terminal the tab Buttons are the tab
// row, so the grid starts with the tab's view.
export const paneView: View = (model, size, sel): Drawn => {
  const isOpen = sel.tab === 'items' && model.items.some(item => item.id === sel.open)
  const body = isOpen ? detailView : (TABS.find(one => one.tab === sel.tab)?.view ?? itemsView)
  const isTerminal = size.surface === 'terminal'
  const head = isTerminal ? HEAD : 0
  const tabLabel = (one: (typeof TABS)[number]) =>
    one.tab === 'items' ? `${one.label} ${model.items.length}` : one.label
  const tabButtons: ViewButton[] = TABS.map(one => ({
    key: `tab-${one.tab}`,
    label: isTerminal ? one.hotkey : tabLabel(one),
    hotkey: one.hotkey,
    action: { type: 'tab', tab: one.tab },
  }))
  const room = (rows: number): Size => ({ ...size, rows: Math.max(1, rows) })
  const first = body(model, room(size.rows - head - HINT), sel)
  const reserve = controlRows({ ...first, buttons: [...first.buttons, ...tabButtons] }, size)
  const inner = body(model, room(size.rows - head - HINT - reserve), sel)

  const g = grid(size.columns, inner.grid.rows + head + HINT)
  if (isTerminal) {
    const isWide = isSplit(size)
    hline(g, 0, 1, size.columns, { fg: C.rule })
    let x = 1
    for (const one of TABS) {
      const isActive = one.tab === sel.tab
      const end = spans(g, x, 0, [[tabLabel(one), { fg: isActive ? C.orange : C.dim }]])
      if (isActive) hline(g, x, 1, end - x, { fg: C.orange }, '━')
      x = end + (isWide ? 4 : 2)
    }
    const keys = '1-4 switch'
    if (isWide && x + keys.length < size.columns)
      spans(g, size.columns - keys.length, 0, [[keys, { fg: C.dim }]])
  }
  paste(g, inner.grid, 0, head)
  spans(g, 1, g.rows - 1, [[hint(sel, isOpen, inner.buttons), { fg: C.dim }]])
  const rows: Drawn['rows'] = {}
  for (const [y, row] of Object.entries(inner.rows ?? {})) rows[Number(y) + head] = row

  return { grid: g, buttons: [...inner.buttons, ...tabButtons], inputs: inner.inputs, rows }
}
