import type { On } from 'claude-code'

export function band(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const running = items.filter(item => item.status === 'running').length
    if (running === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>{running} running · /rabe for details</Text>
      </Box>
    )
  })
}
