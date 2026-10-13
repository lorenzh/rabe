import { controlRows, isPress, type Model, type Node, type Selection, type Size } from './view'
import { HINT, paneView, rowsOf } from './views/pane'

// Where the list stands under the pinned header: `top` rows of the body are
// scrolled away. `scope` and `followed` tell a new view or a new focus from a
// redraw, which keeps the person's own scroll.
export type Pin = { top: number; scope: string; followed: string }

export const NO_PIN: Pin = { top: 0, scope: '', followed: '' }

// The size of the parts of a drawing whose body is taller than the room under
// the header: `above` tree rows of tabs, rule and toolbar, `rows` of body room,
// `total` body rows, `focus` the row span of the selected row, `heads` the
// pieces (in `layout` order) that make up the header.
export type Geometry = {
  above: number
  rows: number
  total: number
  focus?: [number, number]
  heads: number
}

// undefined where the body fits or is no list: the pane then draws as it
// always did.
export function geometry(model: Model, size: Size, sel: Selection): Geometry | undefined {
  const { window: _window, ...bare } = size
  const drawn = paneView(model, bare, sel)
  const head = drawn.toolbar ?? 0
  const above = head + controlRows(drawn, bare)
  const rows = Math.max(1, bare.rows - above - HINT)
  const body = drawn.nodes.slice(head, -1)
  const isRow = (node: Node, key?: string) =>
    'spans' in node &&
    node.spans.some(one => isPress(one) && (key ? one.key === key : one.key.startsWith('row:')))
  // Only a body with rows pins: its rows are focusable, so the arrows move the
  // focus and the pane follows it. A text view keeps the engine's scroll.
  if (!body.some(node => isRow(node))) return undefined
  const total = rowsOf(body)
  if (total <= rows) return undefined
  const at = body.findIndex(node => isRow(node, `row:${sel.selected}`))

  return {
    above,
    rows,
    total,
    ...(at >= 0 && { focus: [rowsOf(body.slice(0, at)), 1] as [number, number] }),
    heads: head + drawn.buttons.length + (drawn.inputs?.length ?? 0),
  }
}

// The pin after a drawing: the person's scroll, clamped; a new view starts at
// the top; a new selected row is brought into view.
export function follow(pin: Pin, geo: Geometry, scope: string, selected: string): Pin {
  const isNew = pin.scope !== scope
  let top = Math.min(Math.max(0, isNew ? 0 : pin.top), geo.total - geo.rows)
  if (geo.focus && (isNew || pin.followed !== selected)) {
    const [at, rows] = geo.focus
    if (at < top) top = at
    else if (at + rows > top + geo.rows) top = at + rows - geo.rows
  }

  return { top, scope, followed: selected }
}
