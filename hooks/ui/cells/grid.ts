import { DEFAULT, type Style } from './palette'

// A fixed grid of terminal cells, row-major, three u32 per cell:
// [codePoint, foreground, background], as a Raster's `cells` hold them.
export type Grid = { readonly columns: number; readonly rows: number; readonly cells: Uint32Array }

export type Cell = [codePoint: number, fg: number, bg: number]

const SPACE = 32
const STAND_IN = '?'

// ponytail: a short table of wide, zero-width and emoji ranges in the BMP;
// a character it misses makes the engine refuse the Raster, naming the cell.
const NOT_WIDTH_1: [number, number][] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05c7],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0e31, 0x0e3a],
  [0x1100, 0x115f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x20d0, 0x20ff],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xd800, 0xdfff],
  [0xf900, 0xfaff],
  [0xfe00, 0xfe0f],
  [0xfe10, 0xfe19],
  [0xfe20, 0xfe2f],
  [0xfe30, 0xfe6f],
  [0xfeff, 0xfeff],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0xfff0, 0xffff],
]

function isWidth1(code: number): boolean {
  if (code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0xad || code > 0xffff) return false

  return !NOT_WIDTH_1.some(([from, to]) => code >= from && code <= to)
}

// One character per cell: whitespace becomes a space, anything that is not a
// printable width-1 BMP character becomes the stand-in.
export function safe(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? SPACE
    out += /\s/.test(ch) ? ' ' : isWidth1(code) ? ch : STAND_IN
  }

  return out
}

export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  const chars = [...safe(text)]
  if (chars.length > width) return `${chars.slice(0, width - 1).join('')}…`

  return chars.join('').padEnd(width)
}

export function grid(columns: number, rows: number, style: Style = {}): Grid {
  const width = Math.max(0, Math.floor(columns))
  const height = Math.max(0, Math.floor(rows))
  const cells = new Uint32Array(width * height * 3)
  for (let i = 0; i < cells.length; i += 3) {
    cells[i] = SPACE
    cells[i + 1] = style.fg ?? DEFAULT
    cells[i + 2] = style.bg ?? DEFAULT
  }

  return { columns: width, rows: height, cells }
}

function put(g: Grid, x: number, y: number, code: number, style: Style): void {
  if (x < 0 || y < 0 || x >= g.columns || y >= g.rows) return
  const i = (y * g.columns + x) * 3
  g.cells[i] = code
  if (style.fg !== undefined) g.cells[i + 1] = style.fg
  if (style.bg !== undefined) g.cells[i + 2] = style.bg
}

export function cell(g: Grid, x: number, y: number): Cell {
  const i = (y * g.columns + x) * 3

  return [g.cells[i] ?? SPACE, g.cells[i + 1] ?? DEFAULT, g.cells[i + 2] ?? DEFAULT]
}

// Writes text from (x, y) to the right; a style leaves the colors it does not
// name as they are. Returns the column after the text, also when it was clipped.
export function write(g: Grid, x: number, y: number, text: string, style: Style = {}): number {
  let at = x
  for (const ch of safe(text)) {
    put(g, at, y, ch.codePointAt(0) ?? SPACE, style)
    at += 1
  }

  return at
}

export function fill(
  g: Grid,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Style = {},
  ch = ' ',
): void {
  const code = safe(ch).codePointAt(0) ?? SPACE
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) put(g, col, row, code, style)
  }
}

export function hline(g: Grid, x: number, y: number, width: number, style: Style = {}, ch = '─') {
  fill(g, x, y, width, 1, style, ch)
}

export function vline(g: Grid, x: number, y: number, height: number, style: Style = {}, ch = '│') {
  fill(g, x, y, 1, height, style, ch)
}

export function box(
  g: Grid,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Style = {},
) {
  if (width < 2 || height < 2) return
  hline(g, x + 1, y, width - 2, style)
  hline(g, x + 1, y + height - 1, width - 2, style)
  vline(g, x, y + 1, height - 2, style)
  vline(g, x + width - 1, y + 1, height - 2, style)
  write(g, x, y, '┌', style)
  write(g, x + width - 1, y, '┐', style)
  write(g, x, y + height - 1, '└', style)
  write(g, x + width - 1, y + height - 1, '┘', style)
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// A bar of `value / max` over `width` cells, in eighths of a block, padded.
export function bar(value: number, max: number, width: number): string {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const eighths = Math.round(share * width * 8)
  const text = `${'█'.repeat(Math.floor(eighths / 8))}${EIGHTHS[eighths % 8]}`

  return text.padEnd(width)
}

export function paste(g: Grid, src: Grid, x: number, y: number): void {
  for (let row = 0; row < src.rows; row++) {
    for (let col = 0; col < src.columns; col++) {
      const [code, fg, bg] = cell(src, col, row)
      put(g, x + col, y + row, code, { fg, bg })
    }
  }
}

// The text of each row, trailing spaces cut: the text fallback and the tests.
export function lines(g: Grid): string[] {
  const out: string[] = []
  for (let row = 0; row < g.rows; row++) {
    let text = ''
    for (let col = 0; col < g.columns; col++) text += String.fromCodePoint(cell(g, col, row)[0])
    out.push(text.trimEnd())
  }

  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytes(g: Grid): Uint8Array {
  const out = new Uint8Array(g.cells.length * 4)
  g.cells.forEach((word, i) => {
    out[i * 4] = word & 0xff
    out[i * 4 + 1] = (word >>> 8) & 0xff
    out[i * 4 + 2] = (word >>> 16) & 0xff
    out[i * 4 + 3] = (word >>> 24) & 0xff
  })

  return out
}

// The Raster `cells` string: little-endian u32 triplets in padded base64.
export function encode(g: Grid): string {
  const b = bytes(g)
  let out = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    out += B64[(n >>> 18) & 63]
    out += B64[(n >>> 12) & 63]
    out += i + 1 < b.length ? B64[(n >>> 6) & 63] : '='
    out += i + 2 < b.length ? B64[n & 63] : '='
  }

  return out
}

export function decode(columns: number, rows: number, base64: string): Grid {
  const clean = base64.replace(/=+$/, '')
  const b = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let at = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].reduce(
      (sum, k) => (sum << 6) | Math.max(0, B64.indexOf(clean[i + k] ?? 'A')),
      0,
    )
    for (const shift of [16, 8, 0]) if (at < b.length) b[at++] = (n >>> shift) & 0xff
  }
  const cells = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < cells.length; i++) {
    cells[i] =
      ((b[i * 4] ?? 0) |
        ((b[i * 4 + 1] ?? 0) << 8) |
        ((b[i * 4 + 2] ?? 0) << 16) |
        ((b[i * 4 + 3] ?? 0) << 24)) >>>
      0
  }

  return { columns, rows, cells }
}

// A run of text in one style; a row is a list of spans.
export type Span = [text: string, style?: Style]

// Writes spans from (x, y), cut at `width` cells with an ellipsis. Returns the
// column after the last cell written.
export function spans(g: Grid, x: number, y: number, list: Span[], width = g.columns - x): number {
  let at = x
  const end = x + width
  for (const [text, style] of list) {
    const room = end - at
    if (room <= 0) break
    const chars = [...safe(text)]
    const shown = chars.length > room ? `${chars.slice(0, room - 1).join('')}…` : chars.join('')
    at = write(g, at, y, shown, style)
  }

  return at
}

// Splits text into lines of at most `width` cells, at spaces where it can.
// After `safe` each character is one UTF-16 unit, so string indexes are cells.
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return []
  const out: string[] = []
  for (const para of text.split('\n')) {
    let rest = safe(para).trimEnd()
    while (rest.length > width) {
      const cut = rest.slice(0, width + 1).lastIndexOf(' ')
      const at = cut > 0 ? cut : width
      out.push(rest.slice(0, at).trimEnd())
      rest = rest.slice(at).trimStart()
    }
    out.push(rest)
  }

  return out
}
