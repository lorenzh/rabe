import type { RabeTab } from '../../../types'
import { grid, hline, paste, spans } from '../cells/grid'
import { C } from '../cells/palette'
import { controlRows, type Drawn, type Size, type View, type ViewButton } from '../view'
import { costView } from './cost'
import { detailView } from './detail'
import { effectsView } from './effects'
import { itemsView } from './items'
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

function hint(isFocused: boolean, isOpen: boolean, tab: RabeTab): string {
  if (!isFocused) return 'tab to select · esc close'
  if (isOpen) return 'b back · esc close'
  if (tab === 'items') return 'j/k move · enter open · 1-4 switch · esc close'

  return '1-4 switch · esc close'
}

// The whole pane: the tab row and its rule, the tab's view (or the open item's
// detail), and the hint, sized so the grid and the controls under it fill
// `size.rows` without scrolling.
export const paneView: View = (model, size, sel): Drawn => {
  const isOpen = sel.tab === 'items' && model.items.some(item => item.id === sel.open)
  const body = isOpen ? detailView : (TABS.find(one => one.tab === sel.tab)?.view ?? itemsView)
  const tabButtons: ViewButton[] = TABS.map(one => ({
    key: `tab-${one.tab}`,
    label: size.surface === 'terminal' ? one.hotkey : `${one.hotkey} ${one.label}`,
    hotkey: one.hotkey,
    action: { type: 'tab', tab: one.tab },
  }))
  const room = (rows: number): Size => ({ ...size, rows: Math.max(1, rows) })
  const first = body(model, room(size.rows - HEAD - HINT), sel)
  const reserve = controlRows({ ...first, buttons: [...first.buttons, ...tabButtons] }, size)
  const inner = body(model, room(size.rows - HEAD - HINT - reserve), sel)

  const g = grid(size.columns, inner.grid.rows + HEAD + HINT)
  hline(g, 0, 1, size.columns, { fg: C.rule })
  let x = 1
  for (const one of TABS) {
    const label = one.tab === 'items' ? `${one.label} ${model.items.length}` : one.label
    const isActive = one.tab === sel.tab
    const end = spans(g, x, 0, [[label, { fg: isActive ? C.orange : C.dim }]])
    if (isActive) hline(g, x, 1, end - x, { fg: C.orange }, '━')
    x = end + 3
  }
  const keys = '1-4 switch'
  if (x + keys.length < size.columns)
    spans(g, size.columns - keys.length, 0, [[keys, { fg: C.dim }]])
  paste(g, inner.grid, 0, HEAD)
  spans(g, 1, g.rows - 1, [[hint(sel.isFocused, isOpen, sel.tab), { fg: C.dim }]])
  const rows: Drawn['rows'] = {}
  for (const [y, row] of Object.entries(inner.rows ?? {})) rows[Number(y) + HEAD] = row

  return { grid: g, buttons: [...inner.buttons, ...tabButtons], inputs: inner.inputs, rows }
}
