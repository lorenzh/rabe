import type { RenderSurface } from 'claude-code'

import type { RabeLines, RabeOrder, RabePrevious, RabeTab, RabeTurn } from '../../types'
import type { RabeItem } from '../model'
import { type Grid, MAX_COLUMNS, MAX_ROWS, type Span } from './cells/grid'

// What every view reads: the sources' session values, never files. `usd` is
// the session's cost as /cost totals it; `previous` is the last session in
// this project that had background work, from `$.store`.
export type Model = {
  items: RabeItem[]
  turns: Record<string, RabeTurn[]>
  lines: Record<string, RabeLines>
  now: number
  usd?: number
  previous?: RabePrevious
}

// The cells a view may fill: `columns` from `bodyColumns`, `rows` from
// `scroll.bodyRows` (pane) or `maxRows` (band). A view draws this size, or
// more rows where a list does not fit: then the pane scrolls. `window` is the
// part of the view's rows the pane shows: from `top` (below 0 while the rows
// above the view show), `rows` high; the pane's `scroll`, where it has one.
export type Size = {
  columns: number
  rows: number
  surface: RenderSurface
  hasInput: boolean
  window?: { top: number; rows: number }
}

// The size a view lays out for: on the terminal no larger than one Raster, so
// what the view keeps in view (the selected row) is never cut off afterwards.
export function bounded(size: Size): Size {
  if (size.surface !== 'terminal') return size

  return {
    ...size,
    columns: Math.min(size.columns, MAX_COLUMNS),
    rows: Math.min(size.rows, MAX_ROWS),
  }
}

// The person's place in the pane, kept in `$.state` (rabe.tab, rabe.selected,
// ...). `selected` is the item whose row holds the focus; `order` the list
// order taken when the pane opened (see `stable` in lists.ts).
export type Selection = {
  tab: RabeTab
  query: string
  folded: string[]
  selected: string
  open: string
  order?: RabeOrder
  isFocused: boolean
}

export type Action =
  | { type: 'tab'; tab: RabeTab }
  | { type: 'open'; id: string }
  | { type: 'fold'; group: string }
  | { type: 'query'; text: string }
  | { type: 'focus'; key: string }
  | { type: 'stop'; ids: string[] }
  | { type: 'delete'; id: string }
  | { type: 'copy'; text: string }
  | { type: 'message'; id: string; text: string }
  | { type: 'none' }

// What a control that is not available now does: nothing. It keeps its slot.
export const NONE: Action = { type: 'none' }

// A control of the toolbar, drawn `[ label ]`. The label carries the key
// ("x: stop"): the engine does not draw hotkeys. Hotkeys are one digit or one
// lowercase letter. A control that is not available now is `dim` with the
// action `NONE` and no hotkey, so it keeps its place.
export type ViewButton = {
  key: string
  label: string
  action: Action
  hotkey?: string
  autoFocus?: true
  dim?: true
}

// An Input under the Buttons; left out where `size.hasInput` is false.
export type ViewInput = {
  key: string
  label: string
  placeholder: string
  submitLabel: string
  value?: string
  // Also sent on each change, not only on Enter.
  isLive?: boolean
  action: (text: string) => Action
}

// A plain Button inside a line: the one pressable thing of a selectable row
// (its name) or a tab. `key` is stable (`row:<item id>`, `group-<id>`,
// `tab-<tab>`), so focus and the arrow keys find it again after a redraw.
// A Button takes no color: `dim` draws it dim at rest and full under the
// focus or the pointer, and `bg` is the background of the Box around it.
export type Press = {
  key: string
  label: string
  action: Action
  hotkey?: string
  autoFocus?: true
  dim?: true
  bg?: number
}

export type Part = Span | Press

export const isPress = (part: Part): part is Press => !Array.isArray(part)

// One row of the body: Text parts and at most one Press per row (a tab bar
// holds one per tab), then a part aligned to the right end. `bg` fills the row.
export type Line = { spans: Part[]; right?: Span[]; bg?: number }

// What a body holds: lines, and charts nobody presses (a Raster on the
// terminal, text elsewhere).
export type Node = Line | { chart: Grid }

// A view's whole output: the body, the controls and the Inputs. These are
// drawn before the node at `toolbar` (the pane's toolbar), else at the end.
export type Drawn = {
  nodes: Node[]
  buttons: ViewButton[]
  inputs?: ViewInput[]
  toolbar?: number
}

// A drawing in document order, which is the order of the focus ring.
export type Piece = Node | { button: ViewButton } | { input: ViewInput }

export function layout(drawn: Drawn): Piece[] {
  const at = drawn.toolbar ?? drawn.nodes.length
  const tools: Piece[] = [
    ...drawn.buttons.map(button => ({ button })),
    ...(drawn.inputs ?? []).map(input => ({ input })),
  ]

  return [...drawn.nodes.slice(0, at), ...tools, ...drawn.nodes.slice(at)]
}

export type View = (model: Model, size: Size, selection: Selection) => Drawn

export const NO_SELECTION: Selection = {
  tab: 'items',
  query: '',
  folded: [],
  selected: '',
  open: '',
  isFocused: false,
}

// The item rows of a drawing in document order: what the arrow keys walk.
// A row kept only for its place (action NONE) is no stop.
export function rowKeys(drawn: Drawn | Piece[]): string[] {
  const list = Array.isArray(drawn) ? drawn : drawn.nodes

  return list.flatMap(node =>
    'spans' in node
      ? node.spans.flatMap(part =>
          isPress(part) && part.key.startsWith('row:') && part.action.type !== 'none'
            ? [part.key]
            : [],
        )
      : [],
  )
}

// The row an arrow key moves the focus to from the row of item `selected`:
// the first row when the focus is on none; undefined past either end.
export function stepRow(keys: string[], selected: string, by: number): string | undefined {
  const at = keys.indexOf(`row:${selected}`)
  if (at === -1) return by > 0 ? keys[0] : undefined

  return keys[at + by]
}

// Rows the toolbar takes: wrapped Buttons ("[ label ]" and a
// gap) and one row per Input.
export function controlRows(drawn: Omit<Drawn, 'nodes'>, size: Size): number {
  let rows = 0
  let used = Infinity
  for (const button of drawn.buttons) {
    const width = button.label.length + 5
    if (used + width > size.columns) {
      rows += 1
      used = 0
    }
    used += width
  }

  return rows + (size.hasInput ? (drawn.inputs?.length ?? 0) : 0)
}

// An agent a workflow script started. Claude Code can stop only the whole run, and cannot message it.
export function isWorkflowAgent(item: RabeItem): boolean {
  if (item.kind !== 'agent') return false

  return (
    item.parentId?.startsWith('workflow:') === true ||
    item.detail.workflowIndex !== undefined ||
    item.detail.workflowPhase !== undefined
  )
}

export function canStop(item: RabeItem): boolean {
  if (item.status !== 'running') return false
  if (item.kind === 'agent') return !isWorkflowAgent(item)
  if (item.kind === 'codex') return true
  if (item.kind === 'shell' || item.kind === 'monitor' || item.kind === 'workflow') {
    return item.detail.taskId !== undefined
  }

  return false
}

export function taskIdOf(item: RabeItem): string | undefined {
  if (item.kind === 'agent') return item.detail.agentId
  if (item.kind === 'shell' || item.kind === 'monitor' || item.kind === 'workflow') {
    return item.detail.taskId
  }

  return undefined
}
