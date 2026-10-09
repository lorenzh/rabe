import type { RenderSurface } from 'claude-code'

import type { RabeLines, RabePrevious, RabeTab, RabeTurn } from '../../types'
import type { RabeItem } from '../model'
import { type Grid, MAX_COLUMNS, MAX_ROWS } from './cells/grid'

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
// `scroll.bodyRows` (pane) or `maxRows` (band). A view draws exactly this size.
export type Size = {
  columns: number
  rows: number
  surface: RenderSurface
  hasInput: boolean
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

// The person's place in the pane, kept in `$.state` (rabe.tab, rabe.selected, ...).
export type Selection = {
  tab: RabeTab
  query: string
  folded: string[]
  selected: string
  open: string
  isFocused: boolean
}

export type Action =
  | { type: 'tab'; tab: RabeTab }
  | { type: 'select'; id: string }
  | { type: 'open'; id: string }
  | { type: 'fold'; group: string }
  | { type: 'query'; text: string }
  | { type: 'focus'; key: string }
  | { type: 'stop'; ids: string[] }
  | { type: 'delete'; id: string }
  | { type: 'copy'; text: string }
  | { type: 'message'; id: string; text: string }

// A Button under the grid. The label carries the key ("j: down"): the engine
// does not draw hotkeys. Hotkeys are one digit or one lowercase letter.
export type ViewButton = {
  key: string
  label: string
  action: Action
  hotkey?: string
  autoFocus?: true
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

// A view's whole output. `rows` maps a grid row to what pressing it does: the
// terminal cannot press a Raster cell, so only the text fallback draws such a
// row as a Button (keyed `key`); the terminal reaches it through the Buttons.
export type Drawn = {
  grid: Grid
  buttons: ViewButton[]
  inputs?: ViewInput[]
  rows?: Record<number, { key: string; action: Action }>
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

// Rows the controls under the grid take: wrapped Buttons ("[ label ]" and a
// gap) and one row per Input.
export function controlRows(drawn: Omit<Drawn, 'grid'>, size: Size): number {
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

export function canStop(item: RabeItem): boolean {
  if (item.status !== 'running') return false
  if (item.kind === 'agent' || item.kind === 'codex') return true
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
