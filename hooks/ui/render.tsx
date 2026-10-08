import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RasterProps,
  RenderSurface,
  TextProps,
} from 'claude-code'

import { encode, lines } from './cells/grid'
import type { Action, Drawn } from './view'

export type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
  Raster?: ElementConstructor<RasterProps>
}

export type Act = (action: Action, surface: RenderSurface) => void

// The one renderer: a Raster on the terminal, else one Text (or Button, for a
// pressable row) per grid row. The Buttons and Inputs follow on every surface.
// Desktop hands out a Raster that draws an empty Box, so the surface decides.
export function render(ui: Ui, surface: RenderSurface, drawn: Drawn, act: Act, key = 'cells') {
  const { Box, Button, Input, Raster, Text } = ui
  const { grid } = drawn
  const body =
    surface === 'terminal' && Raster ? (
      <Raster key={key} columns={grid.columns} rows={grid.rows} cells={encode(grid)} />
    ) : (
      lines(grid).map((line, y) => {
        const row = drawn.rows?.[y]
        return row ? (
          <Button
            key={row.key}
            plain
            label={line.trim() || ' '}
            onPress={press => act(row.action, press.surface)}
          />
        ) : (
          <Text wrap="truncate">{line || ' '}</Text>
        )
      })
    )

  return (
    <Box flexDirection="column">
      {body}
      {drawn.buttons.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
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
