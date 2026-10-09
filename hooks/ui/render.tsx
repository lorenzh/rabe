import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RasterProps,
  RenderSurface,
  TextProps,
} from 'claude-code'

import { clamp, encode, lines } from './cells/grid'
import { C, paint } from './cells/palette'
import {
  type Action,
  type Drawn,
  isPress,
  type Line,
  layout,
  NONE,
  type Part,
  type Piece,
  type ViewButton,
} from './view'

export type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
  Raster?: ElementConstructor<RasterProps>
}

export type Act = (action: Action, surface: RenderSurface) => void

// A focusable element drawn since the pane opened: its key, its latest label,
// and whether it is a control (an Input too) rather than a row Button.
export type Held = { key: string; label: string; isControl?: true }

const keysOf = (piece: Piece): Held[] =>
  'spans' in piece
    ? piece.spans.filter(isPress).map(one => ({ key: one.key, label: one.label }))
    : 'button' in piece
      ? [{ key: piece.button.key, label: piece.button.label, isControl: true }]
      : 'input' in piece
        ? [{ key: piece.input.key, label: piece.input.label, isControl: true }]
        : []

// What stands in for an element that is gone: its key and old label, dim,
// and a press does nothing.
function slot(one: Held): Piece {
  if (one.isControl) return { button: { key: one.key, label: one.label, action: NONE, dim: true } }

  return {
    spans: [
      [' '],
      { key: one.key, label: one.label, action: NONE, dim: true },
      [' · gone', { fg: C.dim }],
    ],
  }
}

// The focus ring stays on an index, so while the pane is open the focusable
// elements it draws only grow at the end: the `before` keys come first, in
// their order, each in place or as a `slot` where it is gone, then the keys
// that are new, in document order. A piece moves only when it must: a held
// one comes forward to its turn, and a new one drawn above a held one goes
// right after the last held one. A line with several Buttons (the tab row)
// moves as one. Returns the pieces to draw and the keys to hold next.
export function hold(list: Piece[], before?: readonly Held[]): { list: Piece[]; held: Held[] } {
  const drawn = list.flatMap(keysOf)
  if (!before) return { list, held: drawn }
  const rank = new Map(before.map((one, i) => [one.key, i]))
  const where = new Map(list.flatMap((piece, i) => keysOf(piece).map(one => [one.key, i] as const)))
  const last = Math.max(-1, ...before.map(one => where.get(one.key) ?? -1))
  const out: Piece[] = []
  const done = new Set<number>()
  const moved: Piece[] = []
  let next = 0
  let isClosed = false
  const upTo = (end: number) => {
    for (; next < end; next++) {
      const one = before[next] as Held
      const at = where.get(one.key)
      if (at === undefined) out.push(slot(one))
      else if (!done.has(at)) {
        done.add(at)
        out.push(list[at] as Piece)
      }
    }
  }
  const close = () => {
    upTo(before.length)
    out.push(...moved)
    isClosed = true
  }
  list.forEach((piece, i) => {
    if (i > last && !isClosed) close()
    if (done.has(i)) return
    const keys = keysOf(piece)
    const first = Math.min(...keys.map(one => rank.get(one.key) ?? Infinity))
    if (keys.length === 0 || isClosed) out.push(piece)
    else if (first < Infinity) upTo(first + 1)
    else moved.push(piece)
  })
  if (!isClosed) close()
  const now = new Map(drawn.map(one => [one.key, one]))

  return {
    list: out,
    held: [
      ...before.map(one => now.get(one.key) ?? one),
      ...drawn.filter(one => !rank.has(one.key)),
    ],
  }
}

// The one renderer, the same tree on every surface: each line a row Box of
// Text parts and plain Buttons, each chart a Raster on the terminal (the
// desktop draws a Raster as an empty Box) and text elsewhere, the controls in
// a row and the Inputs where they stand. Colors go out as `paint` names them
// per surface. A press of an action `none` does nothing.
export function render(
  ui: Ui,
  surface: RenderSurface,
  drawn: Drawn | Piece[],
  act: Act,
  key = 'cells',
) {
  const { Box, Button, Input, Raster, Text } = ui
  const color = (rgb: number | undefined) => paint(rgb, surface)
  const run =
    (action: Action) =>
    (press: { surface: RenderSurface }): void => {
      if (action.type !== 'none') act(action, press.surface)
    }

  const part = (one: Part, hasScope: boolean) =>
    isPress(one) ? (
      <Button
        key={one.key}
        plain
        label={one.label}
        hotkey={one.hotkey}
        autoFocus={one.autoFocus}
        dimColor={one.dim}
        hover={hasScope ? { bold: true } : undefined}
        onPress={run(one.action)}
      />
    ) : (
      <Text color={color(one[1]?.fg)} backgroundColor={color(one[1]?.bg)} wrap="truncate">
        {one[0]}
      </Text>
    )

  // A Button takes no color, so each run of parts on one background sits in
  // a Box of that color. A row with one Button is keyed after it: the hover
  // scope of its label.
  const row = (line: Line) => {
    const presses = line.spans.filter(isPress)
    const scope = presses.length === 1 ? presses[0]?.key : undefined
    const runs: { bg?: number; parts: Part[] }[] = []
    for (const one of line.spans) {
      if (!(isPress(one) ? one.label : one[0])) continue
      const bg = isPress(one) ? one.bg : one[1]?.bg
      const last = runs.at(-1)
      if (last && last.bg === bg) last.parts.push(one)
      else runs.push({ bg, parts: [one] })
    }
    const draw = (parts: Part[]) => parts.map(one => part(one, scope !== undefined))

    return (
      <Box
        {...(scope && { key: `line:${scope}` })}
        flexDirection="row"
        backgroundColor={color(line.bg ?? (runs.length === 1 ? runs[0]?.bg : undefined))}
      >
        {runs.length === 0 && <Text> </Text>}
        {runs.length === 1 && draw(runs[0]?.parts ?? [])}
        {runs.length > 1 &&
          runs.map(run => (
            <Box flexDirection="row" backgroundColor={color(run.bg)}>
              {draw(run.parts)}
            </Box>
          ))}
      </Box>
    )
  }

  const control = (one: ViewButton) => (
    <Button
      key={one.key}
      label={one.label}
      hotkey={one.hotkey}
      autoFocus={one.autoFocus}
      dimColor={one.dim}
      onPress={run(one.action)}
    />
  )

  // Controls side by side wrap as one row.
  const list = Array.isArray(drawn) ? drawn : layout(drawn)
  const runs: (Piece | ViewButton[])[] = []
  for (const piece of list) {
    const last = runs.at(-1)
    if (!('button' in piece)) runs.push(piece)
    else if (Array.isArray(last)) last.push(piece.button)
    else runs.push([piece.button])
  }
  let rows = 0

  return (
    <Box flexDirection="column">
      {runs.flatMap(one => {
        if (Array.isArray(one)) {
          rows += 1
          return [
            <Box
              key={rows > 1 ? `controls-${rows}` : 'controls'}
              flexDirection="row"
              flexWrap="wrap"
              columnGap={1}
            >
              {one.map(control)}
            </Box>,
          ]
        }
        if ('input' in one) {
          const { input } = one
          return Input
            ? [
                <Input
                  key={input.key}
                  label={input.label}
                  placeholder={input.placeholder}
                  value={input.value}
                  submitLabel={input.submitLabel}
                  onInput={input.isLive ? text => act(input.action(text), surface) : undefined}
                  onSubmit={text => act(input.action(text), surface)}
                />,
              ]
            : []
        }
        if ('spans' in one) return [row(one)]
        if (!('chart' in one)) return []
        const cut = clamp(one.chart)
        return surface === 'terminal' && Raster
          ? [<Raster key={key} columns={cut.columns} rows={cut.rows} cells={encode(cut)} />]
          : lines(one.chart).map(text => <Text wrap="truncate">{text || ' '}</Text>)
      })}
    </Box>
  )
}
