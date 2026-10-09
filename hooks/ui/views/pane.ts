import type { RabeTab } from '../../../types'
import { C } from '../cells/palette'
import {
  controlRows,
  type Drawn,
  isPress,
  type Line,
  type Node,
  type Press,
  type Selection,
  type Size,
  type View,
} from '../view'
import { costView } from './cost'
import { detailView } from './detail'
import { effectsView } from './effects'
import { isSplit, itemsView } from './items'
import { fitLine } from './lines'
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

// The hint names the keys the tab binds: the arrows and Enter over its rows,
// and the letters of its controls.
const WORDS: Record<string, string> = {
  stop: 'x stop',
  'stop-group': 'g stop group',
}

const hasRows = (nodes: Node[]) =>
  nodes.some(
    node => 'spans' in node && node.spans.some(p => isPress(p) && p.key.startsWith('row:')),
  )

function hint(sel: Selection, isOpen: boolean, inner: Drawn): string {
  if (!sel.isFocused) return 'tab to select · esc close'
  if (isOpen) return 'b back · esc close'
  const move = hasRows(inner.nodes) ? ['↑↓ move', 'enter open'] : []

  return [...move, ...inner.buttons.flatMap(one => WORDS[one.key] ?? []), 'esc close'].join(' · ')
}

const rowsOf = (nodes: Node[]) =>
  nodes.reduce((n, node) => n + ('chart' in node ? node.chart.rows : 1), 0)

// The whole pane: the tab row (a plain Button per tab, hotkeys 1-4) and its
// rule, the tab's view (or the open item's detail), and the hint at the
// bottom. The view gets the rows its controls leave; a list longer than that
// makes the pane scroll, and the focus carries the window along.
export const paneView: View = (model, size, sel): Drawn => {
  const isOpen = sel.tab === 'items' && model.items.some(item => item.id === sel.open)
  const body = isOpen ? detailView : (TABS.find(one => one.tab === sel.tab)?.view ?? itemsView)
  const gap = isSplit(size) ? 4 : 2
  const tabs: Press[] = TABS.map(one => ({
    key: `tab-${one.tab}`,
    label: one.tab === 'items' ? `${one.label} ${model.items.length}` : one.label,
    hotkey: one.hotkey,
    action: { type: 'tab', tab: one.tab },
    ...(one.tab !== sel.tab && { dim: true }),
  }))
  const keys = '1-4 switch'
  const width = tabs.reduce((n, one) => n + one.label.length + gap, 1)
  const head: Line = {
    spans: tabs.flatMap((one, i) => (i ? [[' '.repeat(gap)], one] : [[' '], one])),
    ...(gap > 2 && width + keys.length < size.columns && { right: [[keys, { fg: C.dim }]] }),
  }
  const at = tabs.findIndex(one => one.key === `tab-${sel.tab}`)
  const from = tabs.slice(0, Math.max(0, at)).reduce((n, one) => n + one.label.length + gap, 1)
  const under = tabs[at]?.label.length ?? 0
  const rule: Line = {
    spans: [
      ['─'.repeat(from), { fg: C.rule }],
      ['━'.repeat(under), { fg: C.orange }],
      ['─'.repeat(Math.max(0, size.columns - from - under)), { fg: C.rule }],
    ],
  }
  const room = (rows: number): Size => ({ ...size, rows: Math.max(1, rows) })
  const first = body(model, room(size.rows - HEAD - HINT), sel)
  const rows = size.rows - HEAD - HINT - controlRows(first, size)
  const inner = body(model, room(rows), sel)
  const pad = Math.max(0, rows - rowsOf(inner.nodes))
  const nodes: Node[] = [
    fitLine(head, size.columns),
    fitLine(rule, size.columns),
    ...inner.nodes,
    ...Array.from({ length: pad }, (): Line => ({ spans: [] })),
    fitLine({ spans: [[` ${hint(sel, isOpen, inner)}`, { fg: C.dim }]] }, size.columns),
  ]

  return { nodes, buttons: inner.buttons, inputs: inner.inputs }
}
