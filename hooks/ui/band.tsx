import type { On } from 'claude-code'

import { fit } from './format'
import { bandLine, bandRows, costLine, joinFit } from './lists'

const LABEL = 12

export function band(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    if (!items.some(item => item.status === 'running')) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const rows = bandRows(items, now)
    const cost = costLine(items)
    const width = Math.max(10, e.props.bodyColumns - LABEL - 1)

    if (rows.length + (cost ? 1 : 0) > e.props.maxRows) {
      return (
        <Box>
          <Text wrap="truncate">{bandLine(items, now)} · /rabe for details</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Box flexDirection="row" columnGap={1}>
            <Text color={row.tone}>{row.glyph}</Text>
            <Text>{fit(`${row.label} ${row.names.length}`, LABEL - 2)}</Text>
            <Text color={row.label === 'failed' ? 'error' : 'subtle'} wrap="truncate">
              {joinFit(row.names, width)}
            </Text>
          </Box>
        ))}
        {cost && (
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>{fit('$ cost', LABEL)}</Text>
            <Text dimColor wrap="truncate">
              {cost}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
