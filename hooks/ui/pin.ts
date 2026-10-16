import {
  controlRows,
  isPress,
  type Model,
  type Piece,
  type Selection,
  type Size,
  type ViewButton,
} from './view'
import { HINT, paneView, rowsOf } from './views/pane'

// Where the list stands under the pinned header: `top` rows of the body are
// scrolled away. `scope` and `followed` tell a new view or a new focus from a
// redraw, which keeps the person's own scroll.
export type Pin = { top: number; scope: string; followed: string }

export const NO_PIN: Pin = { top: 0, scope: '', followed: '' }

// Where a pinned drawing's view starts: `above` tree rows of tabs, rule and
// toolbar of the view as drawn fresh, `rows` of body room under them, `head`
// the lines above the toolbar. `paneView` counts its window from this header.
// `isTight`: the whole header leaves under `MIN_ROWS` list rows, so only the
// tabs and their rule stay and the toolbar scrolls with the body.
export type Fresh = { above: number; rows: number; head: number; isTight: boolean }

export const MIN_ROWS = 3

// undefined where the body fits or is no list: the pane then draws as it
// always did.
export function geometry(model: Model, size: Size, sel: Selection): Fresh | undefined {
  const { window: _window, ...bare } = size
  const drawn = paneView(model, bare, sel)
  const head = drawn.toolbar ?? 0
  const tools = controlRows(drawn, bare)
  const isTight = bare.rows - head - tools - HINT < MIN_ROWS
  const above = isTight ? head : head + tools
  const rows = Math.max(1, bare.rows - above - HINT)
  // Not even the tabs leave room for a few rows: the engine's scroll then.
  if (rows < MIN_ROWS) return undefined
  const body = drawn.nodes.slice(head, -1)
  // Only a body with rows pins: its rows are focusable, so the arrows move the
  // focus and the pane follows it. A text view keeps the engine's scroll.
  const hasRows = body.some(
    node => 'spans' in node && node.spans.some(one => isPress(one) && one.key.startsWith('row:')),
  )
  if (!hasRows || rowsOf(body) + (isTight ? tools : 0) <= rows) return undefined

  return { above, rows, head, isTight }
}

// The lines that go on the row at `at` (`joins`), drawn under it.
function joined(body: Piece[], at: number): number {
  let n = 0
  while (true) {
    const next = body[at + 1 + n]
    if (!next || !('spans' in next) || !next.joins) return n
    n++
  }
}

const isTool = (piece?: Piece) => piece !== undefined && ('button' in piece || 'input' in piece)

// The pieces under the clipped box: the hint, and each control or Input that
// held order put after the last line with a press. Only plain lines follow
// those, so drawing them under the box keeps the focus order.
export function tailOf(list: Piece[]): (at: number) => boolean {
  const last = list.findLastIndex(piece => 'spans' in piece && piece.spans.some(isPress))

  return at => at === list.length - 1 || (at > last && isTool(list[at]))
}

// Tree rows of pieces as `render` draws them: a run of controls wraps as one
// row of Buttons, an Input takes a row where the surface has one.
function rowsIn(list: Piece[], size: Size): number {
  let rows = 0
  let run: ViewButton[] = []
  for (const piece of [...list, undefined]) {
    if (piece && 'button' in piece) {
      run.push(piece.button)
      continue
    }
    rows += run.length ? controlRows({ buttons: run }, size) : 0
    run = []
    if (!piece) break
    if ('input' in piece) rows += size.hasInput ? 1 : 0
    else rows += rowsOf([piece])
  }

  return rows
}

// The size of the parts of a pinned drawing, measured on the pieces the pane
// draws (held order, gone slots included): the header ends where the body's
// first line stands (`split`), `above` its rows, `rows` the body room between
// it and the tail, `total` the body rows, `focus` the row span of the piece
// with `key`: the ring's control or Input where it stands in the body, else the
// selected row. `floor` is the least scroll that leaves `MIN_ROWS` list rows in
// view when the focus lands on a row (0 unless the toolbar scrolls with the body).
export type Geometry = {
  above: number
  rows: number
  total: number
  split: number
  key: string
  floor: number
  focus?: [number, number]
}

export function measure(
  list: Piece[],
  head: number,
  size: Size,
  selected: string,
  ring?: string,
  isTight = false,
): Geometry {
  let lines = 0
  // Tight: the controls are body rows, so the first piece past the head lines
  // starts the body, a control or not.
  const first = list.findIndex(piece =>
    isTool(piece) ? isTight && lines >= head : lines++ >= head,
  )
  const split = first < 0 ? list.length : first
  const isTail = tailOf(list)
  const body: Piece[] = []
  const tail: Piece[] = []
  list.forEach((piece, at) => {
    if (at >= split) (isTail(at) ? tail : body).push(piece)
  })
  const above = rowsIn(list.slice(0, split), size)
  const rows = Math.max(1, size.rows - above - rowsIn(tail, size))
  const has = (piece: Piece, key: string) =>
    'spans' in piece
      ? piece.spans.some(one => isPress(one) && one.key === key)
      : 'button' in piece
        ? piece.button.key === key
        : 'input' in piece && piece.input.key === key
  const ringAt = ring ? body.findIndex(piece => isTool(piece) && has(piece, ring)) : -1
  const key = ringAt >= 0 && ring ? ring : `row:${selected}`
  const at = ringAt >= 0 ? ringAt : body.findIndex(piece => has(piece, key))
  const listAt = body.findIndex(
    piece =>
      'spans' in piece && piece.spans.some(one => isPress(one) && one.key.startsWith('row:')),
  )
  const floor =
    isTight && listAt >= 0 ? Math.max(0, rowsIn(body.slice(0, listAt), size) + MIN_ROWS - rows) : 0
  const piece = at >= 0 ? (body[at] as Piece) : undefined
  // A control wraps with its run: it stands on the last row of the run up to it.
  const focus: [number, number] | undefined =
    at < 0
      ? undefined
      : piece && 'button' in piece
        ? [rowsIn(body.slice(0, at + 1), size) - 1, 1]
        : [rowsIn(body.slice(0, at), size), rowsIn([piece as Piece], size) + joined(body, at)]

  return {
    above,
    rows,
    total: rowsIn(body, size),
    split,
    key,
    floor,
    ...(focus && { focus }),
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
    // A landing on a row keeps `MIN_ROWS` list rows in view, even where the
    // toolbar then scrolls away; the ring brings it back when it lands there.
    if (geo.key.startsWith('row:')) top = Math.min(Math.max(top, geo.floor), geo.total - geo.rows)
  }

  return { top, scope, followed: selected }
}
