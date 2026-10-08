import type { Register } from 'claude-code'

const PANE = 'rabe'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rabe',
      description:
        'Show background work: agents, Codex jobs, shells, monitors, cron jobs and workflows',
    })

    return next(e)
  })

  on('command.run', { command: 'rabe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Rabe' })

    return { text: 'Rabe opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text dimColor>Nothing runs in the background.</Text>
      </Box>
    )
  })
}
