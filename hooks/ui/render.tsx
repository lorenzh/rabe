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
import { paint } from './cells/palette'
import { type Action, type Drawn, isPress, type Line, type Part } from './view'

export type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
  Raster?: ElementConstructor<RasterProps>
}

export type Act = (action: Action, surface: RenderSurface) => void

// The one renderer, the same tree on every surface: each line a row Box of
// Text parts and plain Buttons, each chart a Raster on the terminal (the
// desktop draws a Raster as an empty Box) and text elsewhere, then the
// controls and the Inputs. Colors go out as `paint` names them per surface.
export function render(ui: Ui, surface: RenderSurface, drawn: Drawn, act: Act, key = 'cells') {
  const { Box, Button, Input, Raster, Text } = ui
  const color = (rgb: number | undefined) => paint(rgb, surface)

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
        onPress={press => act(one.action, press.surface)}
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

  return (
    <Box flexDirection="column">
      {drawn.nodes.flatMap(node => {
        if (!('chart' in node)) return [row(node)]
        const cut = clamp(node.chart)
        return surface === 'terminal' && Raster
          ? [<Raster key={key} columns={cut.columns} rows={cut.rows} cells={encode(cut)} />]
          : lines(node.chart).map(one => <Text wrap="truncate">{one || ' '}</Text>)
      })}
      {drawn.buttons.length > 0 && (
        <Box key="controls" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {drawn.buttons.map(one => (
            <Button
              key={one.key}
              label={one.label}
              hotkey={one.hotkey}
              autoFocus={one.autoFocus}
              onPress={press => act(one.action, press.surface)}
            />
          ))}
        </Box>
      )}
      {Input &&
        drawn.inputs?.map(one => (
          <Input
            key={one.key}
            label={one.label}
            placeholder={one.placeholder}
            value={one.value}
            submitLabel={one.submitLabel}
            onInput={one.isLive ? text => act(one.action(text), surface) : undefined}
            onSubmit={text => act(one.action(text), surface)}
          />
        ))}
    </Box>
  )
}
